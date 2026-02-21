"""FFmpeg subprocess management for publishing raw frames to MediaMTX."""
from __future__ import annotations

import logging
import subprocess

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


class FFmpegPublisher:
    """Publish raw BGR frames to MediaMTX via FFmpeg stdin."""

    def __init__(self, stream_id: str, width: int, height: int, fps: float):
        self.stream_id = stream_id
        self.width = width
        self.height = height
        self.fps = max(1, int(round(fps if fps > 0 else 25)))
        self.enabled = MEDIAMTX_ENABLED
        self.process: subprocess.Popen | None = None
        self._codec_candidates = self._codec_order()
        self._codec_index = 0
        self._restart_attempts_current = 0

    def _codec_order(self) -> list[str]:
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

    @property
    def _codec(self) -> str:
        return self._codec_candidates[min(self._codec_index, len(self._codec_candidates) - 1)]

    def _build_command(self, codec: str) -> list[str]:
        command = [
            FFMPEG_BIN,
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "bgr24",
            "-s",
            f"{self.width}x{self.height}",
            "-r",
            str(self.fps),
            "-i",
            "pipe:0",
            "-an",
        ]

        if FFMPEG_SCALE_WIDTH > 0 and FFMPEG_SCALE_HEIGHT > 0:
            command.extend(
                ["-vf", f"scale={FFMPEG_SCALE_WIDTH}:{FFMPEG_SCALE_HEIGHT}:flags=fast_bilinear"]
            )

        if codec == "h264_nvenc":
            command.extend(
                [
                    "-c:v",
                    "h264_nvenc",
                    "-preset",
                    FFMPEG_NVENC_PRESET,
                    "-tune",
                    "ull",
                    "-b:v",
                    FFMPEG_VIDEO_BITRATE,
                ]
            )
        elif codec == "h264_videotoolbox":
            command.extend(
                [
                    "-c:v",
                    "h264_videotoolbox",
                    "-realtime",
                    "true",
                    "-b:v",
                    FFMPEG_VIDEO_BITRATE,
                ]
            )
        else:
            keyint_min = max(1, FFMPEG_GOP // 2)
            command.extend(
                [
                    "-c:v",
                    "libx264",
                    "-preset",
                    FFMPEG_LIBX264_PRESET,
                    "-tune",
                    "zerolatency",
                    "-g",
                    str(FFMPEG_GOP),
                    "-keyint_min",
                    str(keyint_min),
                ]
            )

        command.extend(["-rtsp_transport", "tcp", "-f", "rtsp", build_rtsp_publish_url(self.stream_id)])
        return command

    def _spawn(self) -> bool:
        if not self.enabled:
            return False
        codec = self._codec
        try:
            self.process = subprocess.Popen(
                self._build_command(codec),
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                bufsize=0,
            )
            logger.info("[%s] FFmpeg publisher started (%s)", self.stream_id, codec)
            return True
        except FileNotFoundError:
            self.enabled = False
            logger.warning("[%s] FFmpeg binary not found: %s", self.stream_id, FFMPEG_BIN)
            return False
        except Exception as exc:
            logger.warning("[%s] Failed to start FFmpeg (%s): %s", self.stream_id, codec, exc)
            return False

    def start(self) -> None:
        if not self.enabled:
            return
        if self.process and self.process.poll() is None:
            return
        if not self._spawn():
            self._advance_codec()
            if self._codec_index < len(self._codec_candidates):
                self._spawn()

    def _advance_codec(self) -> None:
        self._codec_index += 1
        self._restart_attempts_current = 0

    def _restart_or_fallback(self) -> bool:
        self.close()
        # Try restarting current codec once before fallback.
        if self._restart_attempts_current < 1:
            self._restart_attempts_current += 1
            return self._spawn()

        self._advance_codec()
        if self._codec_index >= len(self._codec_candidates):
            self.enabled = False
            return False
        return self._spawn()

    def push(self, frame) -> None:
        if not self.enabled:
            return
        if not self.process or self.process.poll() is not None:
            if not self._restart_or_fallback():
                logger.warning("[%s] FFmpeg disabled: no working codec/process", self.stream_id)
                return

        payload = frame.tobytes()
        # Each codec may be tried twice (initial + one restart), so worst case
        # is 2 iterations per candidate codec.
        attempts = 2 * len(self._codec_candidates)
        for _ in range(attempts):
            try:
                if not self.process or not self.process.stdin:
                    raise BrokenPipeError
                self.process.stdin.write(payload)
                return
            except (BrokenPipeError, OSError):
                if not self._restart_or_fallback():
                    logger.warning("[%s] FFmpeg disabled after repeated pipe failures", self.stream_id)
                    return

    def _drain_stderr(self) -> None:
        """Read and log any buffered stderr from FFmpeg before closing."""
        if not self.process or not self.process.stderr:
            return
        try:
            output = self.process.stderr.read()
            if output:
                text = output.decode("utf-8", errors="replace").strip()
                if text:
                    logger.warning("[%s] FFmpeg stderr:\n%s", self.stream_id, text)
        except Exception:
            pass

    def close(self) -> None:
        if not self.process:
            return
        self._drain_stderr()
        try:
            if self.process.stdin:
                self.process.stdin.close()
        except Exception:
            pass
        try:
            self.process.terminate()
            self.process.wait(timeout=1)
        except Exception:
            try:
                self.process.kill()
            except Exception:
                pass
        finally:
            self.process = None
