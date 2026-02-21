"""FFmpeg subprocess for publishing video directly from source to MediaMTX."""
from __future__ import annotations

import json
import logging
import subprocess
from urllib.parse import urlparse

from common.config.mediamtx import (
    FFMPEG_BIN,
    FFMPEG_CODEC,
    FFMPEG_GOP,
    FFMPEG_LIBX264_PRESET,
    FFMPEG_NVENC_PRESET,
    FFMPEG_SCALE_HEIGHT,
    FFMPEG_SCALE_WIDTH,
    FFMPEG_VIDEO_BITRATE,
    MEDIAMTX_ENABLED,
    build_rtsp_publish_url,
)

logger = logging.getLogger(__name__)


def _is_remote(source_url: str) -> bool:
    scheme = urlparse(source_url).scheme.lower()
    return scheme in {"rtsp", "rtsps", "http", "https", "rtmp", "udp", "tcp"}


def _probe_video_codec(source_url: str) -> str | None:
    """Use ffprobe to detect the source video codec. Returns e.g. 'h264'."""
    ffprobe_bin = FFMPEG_BIN.replace("ffmpeg", "ffprobe")
    try:
        result = subprocess.run(
            [
                ffprobe_bin,
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=codec_name",
                "-of", "json",
                source_url,
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return None
        data = json.loads(result.stdout)
        streams = data.get("streams", [])
        if streams:
            return streams[0].get("codec_name")
    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError, Exception) as exc:
        logger.debug("ffprobe failed for %s: %s", source_url, exc)
    return None


def _codec_order() -> list[str]:
    """Build the ordered list of codecs to try for transcoding."""
    configured = FFMPEG_CODEC.strip().lower()
    if configured in {"auto", ""}:
        return ["h264_nvenc", "h264_videotoolbox", "libx264"]
    if configured == "h264_nvenc":
        return ["h264_nvenc", "libx264"]
    if configured == "h264_videotoolbox":
        return ["h264_videotoolbox", "libx264"]
    if configured == "libx264":
        return ["libx264"]
    return [configured, "libx264"]


def _transcode_args(codec: str) -> list[str]:
    """Return codec-specific encoding arguments."""
    if codec == "h264_nvenc":
        return [
            "-c:v", "h264_nvenc",
            "-preset", FFMPEG_NVENC_PRESET,
            "-tune", "ull",
            "-b:v", FFMPEG_VIDEO_BITRATE,
        ]
    if codec == "h264_videotoolbox":
        return [
            "-c:v", "h264_videotoolbox",
            "-realtime", "true",
            "-b:v", FFMPEG_VIDEO_BITRATE,
        ]
    keyint_min = max(1, FFMPEG_GOP // 2)
    return [
        "-c:v", "libx264",
        "-preset", FFMPEG_LIBX264_PRESET,
        "-tune", "zerolatency",
        "-g", str(FFMPEG_GOP),
        "-keyint_min", str(keyint_min),
    ]


class FFmpegDirectPublisher:
    """Publish video directly from source to MediaMTX via FFmpeg.

    FFmpeg reads the source file/URL itself — no Python in the video path.
    For H.264 sources, uses ``-c:v copy`` (zero-cost remux).
    Otherwise transcodes with the configured codec chain.
    """

    def __init__(self, source_url: str, stream_id: str, loop: bool = False):
        self.source_url = source_url
        self.stream_id = stream_id
        self.loop = loop
        self.enabled = MEDIAMTX_ENABLED
        self.process: subprocess.Popen | None = None
        self._can_copy = False
        self._codec_candidates = _codec_order()
        self._codec_index = 0

    def _probe(self) -> None:
        """Detect source codec to decide copy vs transcode."""
        is_remote = _is_remote(self.source_url)
        looping = self.loop and not is_remote

        codec = _probe_video_codec(self.source_url)
        if codec and codec.lower() in ("h264",) and not looping:
            # Copy mode only for non-looping sources. Looping with -c:v copy
            # causes timestamp discontinuities at the loop boundary that break
            # the RTSP session (MediaMTX drops frames / connection resets).
            self._can_copy = True
            logger.info("[%s] Source codec is %s — will use -c:v copy", self.stream_id, codec)
        else:
            self._can_copy = False
            reason = "looping file" if looping else (codec or "unknown")
            logger.info(
                "[%s] Source codec is %s (%s) — will transcode with %s",
                self.stream_id, codec or "unknown", reason, self._codec_candidates[0],
            )

    def _build_command(self, use_copy: bool, transcode_codec: str | None = None) -> list[str]:
        is_remote = _is_remote(self.source_url)
        looping = self.loop and not is_remote
        cmd = [FFMPEG_BIN, "-loglevel", "error"]

        # Looping for local files
        if looping:
            cmd.extend(["-stream_loop", "-1"])

        # Read at native framerate for files (prevents reading faster than realtime)
        if not is_remote:
            cmd.append("-re")

        # RTSP input transport
        if self.source_url.lower().startswith("rtsp"):
            cmd.extend(["-rtsp_transport", "tcp"])

        cmd.extend(["-i", self.source_url])

        # No audio
        cmd.append("-an")

        if use_copy:
            cmd.extend(["-c:v", "copy"])
        else:
            codec = transcode_codec or self._codec_candidates[0]
            # Optional scaling (only when transcoding)
            if FFMPEG_SCALE_WIDTH > 0 and FFMPEG_SCALE_HEIGHT > 0:
                cmd.extend(
                    ["-vf", f"scale={FFMPEG_SCALE_WIDTH}:{FFMPEG_SCALE_HEIGHT}:flags=fast_bilinear"]
                )
            cmd.extend(_transcode_args(codec))

        # Output to MediaMTX RTSP
        cmd.extend(["-rtsp_transport", "tcp", "-f", "rtsp", build_rtsp_publish_url(self.stream_id)])
        return cmd

    def start(self) -> bool:
        """Start the FFmpeg subprocess. Returns True on success."""
        if not self.enabled:
            return False
        if self.process and self.process.poll() is None:
            return True  # Already running

        self._probe()

        # Try copy mode first if source is H.264
        if self._can_copy:
            if self._spawn(use_copy=True):
                return True
            logger.warning("[%s] Copy mode failed, falling back to transcode", self.stream_id)

        # Try each transcode codec
        for i, codec in enumerate(self._codec_candidates):
            self._codec_index = i
            if self._spawn(use_copy=False, transcode_codec=codec):
                return True

        logger.error("[%s] All FFmpeg codec candidates failed", self.stream_id)
        self.enabled = False
        return False

    def _spawn(self, use_copy: bool, transcode_codec: str | None = None) -> bool:
        self.close()
        label = "copy" if use_copy else (transcode_codec or "transcode")
        try:
            cmd = self._build_command(use_copy, transcode_codec)
            logger.info("[%s] FFmpeg command: %s", self.stream_id, " ".join(cmd))
            self.process = subprocess.Popen(
                cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            logger.info("[%s] FFmpeg direct publisher started (%s, pid=%s)",
                        self.stream_id, label, self.process.pid)
            return True
        except FileNotFoundError:
            self.enabled = False
            logger.warning("[%s] FFmpeg binary not found: %s", self.stream_id, FFMPEG_BIN)
            return False
        except Exception as exc:
            logger.warning("[%s] Failed to start FFmpeg (%s): %s", self.stream_id, label, exc)
            return False

    def is_alive(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def close(self) -> None:
        if not self.process:
            return
        try:
            self.process.terminate()
            self.process.wait(timeout=2)
        except Exception:
            try:
                self.process.kill()
            except Exception:
                pass
        finally:
            self.process = None
