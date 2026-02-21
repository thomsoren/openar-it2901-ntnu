"""Tests for FFmpeg publisher — command construction, codec fallback, URL classification."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from cv.ffmpeg import (
    FFmpegDirectPublisher,
    _codec_order,
    _is_remote,
    _transcode_args,
)


# ---------- _is_remote URL classification ----------

class TestIsRemote:
    def test_rtsp(self):
        assert _is_remote("rtsp://host/path") is True

    def test_rtsps(self):
        assert _is_remote("rtsps://host/path") is True

    def test_http(self):
        assert _is_remote("http://host/path") is True

    def test_local_file(self):
        assert _is_remote("/data/video.mp4") is False

    def test_empty(self):
        assert _is_remote("") is False


# ---------- _codec_order ----------

class TestCodecOrder:
    def test_auto(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_CODEC", "auto")
        assert _codec_order() == ["h264_nvenc", "h264_videotoolbox", "libx264"]

    def test_empty_string_is_auto(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_CODEC", "")
        assert _codec_order() == ["h264_nvenc", "h264_videotoolbox", "libx264"]

    def test_nvenc(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_CODEC", "h264_nvenc")
        assert _codec_order() == ["h264_nvenc", "libx264"]

    def test_videotoolbox(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_CODEC", "h264_videotoolbox")
        assert _codec_order() == ["h264_videotoolbox", "libx264"]

    def test_libx264_only(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_CODEC", "libx264")
        assert _codec_order() == ["libx264"]

    def test_unknown_falls_back(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_CODEC", "my_custom")
        assert _codec_order() == ["my_custom", "libx264"]


# ---------- _transcode_args ----------

class TestTranscodeArgs:
    def test_nvenc_args(self):
        args = _transcode_args("h264_nvenc")
        assert "-c:v" in args
        assert "h264_nvenc" in args
        assert "-tune" in args
        assert "ull" in args

    def test_videotoolbox_args(self):
        args = _transcode_args("h264_videotoolbox")
        assert "h264_videotoolbox" in args
        assert "-realtime" in args

    def test_libx264_args(self):
        args = _transcode_args("libx264")
        assert "libx264" in args
        assert "-tune" in args
        assert "zerolatency" in args
        assert "-g" in args


# ---------- _build_command ----------

class TestBuildCommand:
    def _make_publisher(self, source_url="video.mp4", stream_id="test", loop=False, **kwargs):
        pub = FFmpegDirectPublisher(source_url=source_url, stream_id=stream_id, loop=loop)
        return pub

    def test_copy_mode_local_file(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_BIN", "ffmpeg")
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_SCALE_WIDTH", 0)
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_SCALE_HEIGHT", 0)
        pub = self._make_publisher(source_url="/data/video.mp4", loop=False)
        cmd = pub._build_command(use_copy=True)
        assert "-c:v" in cmd
        assert "copy" in cmd
        assert "-re" in cmd  # local file → realtime pacing
        assert "-stream_loop" not in cmd  # not looping

    def test_copy_mode_remote(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_BIN", "ffmpeg")
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_SCALE_WIDTH", 0)
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_SCALE_HEIGHT", 0)
        pub = self._make_publisher(source_url="rtsp://cam/live", loop=False)
        cmd = pub._build_command(use_copy=True)
        assert "copy" in cmd
        assert "-re" not in cmd  # remote → no realtime throttle
        assert "-fflags" in cmd  # nobuffer for remote

    def test_transcode_local_looping(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_BIN", "ffmpeg")
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_SCALE_WIDTH", 0)
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_SCALE_HEIGHT", 0)
        pub = self._make_publisher(source_url="/data/video.mp4", loop=True)
        cmd = pub._build_command(use_copy=False, transcode_codec="libx264")
        assert "-stream_loop" in cmd
        assert "-1" in cmd
        assert "-re" in cmd
        assert "libx264" in cmd

    def test_rtsp_input_uses_tcp(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_BIN", "ffmpeg")
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_SCALE_WIDTH", 0)
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_SCALE_HEIGHT", 0)
        pub = self._make_publisher(source_url="rtsp://cam/live", loop=False)
        cmd = pub._build_command(use_copy=True)
        # Input transport should be TCP for RTSP
        rtsp_idx = cmd.index("-rtsp_transport")
        assert cmd[rtsp_idx + 1] == "tcp"

    def test_scaling_when_transcoding(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_BIN", "ffmpeg")
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_SCALE_WIDTH", 1280)
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_SCALE_HEIGHT", 720)
        pub = self._make_publisher(source_url="/data/video.mp4", loop=False)
        cmd = pub._build_command(use_copy=False, transcode_codec="libx264")
        assert "-vf" in cmd
        vf_idx = cmd.index("-vf")
        assert "1280" in cmd[vf_idx + 1]
        assert "720" in cmd[vf_idx + 1]

    def test_no_scaling_in_copy_mode(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_BIN", "ffmpeg")
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_SCALE_WIDTH", 1280)
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_SCALE_HEIGHT", 720)
        pub = self._make_publisher(source_url="/data/video.mp4", loop=False)
        cmd = pub._build_command(use_copy=True)
        assert "-vf" not in cmd

    def test_output_ends_with_rtsp_url(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_BIN", "ffmpeg")
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_SCALE_WIDTH", 0)
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_SCALE_HEIGHT", 0)
        pub = self._make_publisher(source_url="/data/video.mp4", stream_id="my-stream")
        cmd = pub._build_command(use_copy=True)
        assert cmd[-2] == "rtsp"  # -f rtsp
        assert "my-stream" in cmd[-1]  # rtsp://.../{stream_id}


# ---------- Publisher lifecycle ----------

class TestPublisherLifecycle:
    def test_disabled_returns_false(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.MEDIAMTX_ENABLED", False)
        pub = FFmpegDirectPublisher(source_url="video.mp4", stream_id="s1")
        assert pub.start() is False

    def test_h264_looping_forces_transcode(self, monkeypatch):
        """H.264 + loop=True should skip copy mode due to timestamp discontinuity."""
        monkeypatch.setattr("cv.ffmpeg.MEDIAMTX_ENABLED", True)
        pub = FFmpegDirectPublisher(source_url="/data/video.mp4", stream_id="s1", loop=True)
        pub._probe()
        # Simulate h264 source probe
        with patch("cv.ffmpeg._probe_video_codec", return_value="h264"):
            pub._probe()
        # loop + local file → _can_copy should be False
        assert pub._can_copy is False

    def test_h264_non_looping_enables_copy(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.MEDIAMTX_ENABLED", True)
        with patch("cv.ffmpeg._probe_video_codec", return_value="h264"):
            pub = FFmpegDirectPublisher(source_url="/data/video.mp4", stream_id="s1", loop=False)
            pub._probe()
        assert pub._can_copy is True

    def test_non_h264_forces_transcode(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.MEDIAMTX_ENABLED", True)
        with patch("cv.ffmpeg._probe_video_codec", return_value="hevc"):
            pub = FFmpegDirectPublisher(source_url="/data/video.mp4", stream_id="s1", loop=False)
            pub._probe()
        assert pub._can_copy is False

    def test_all_codecs_fail_disables(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.MEDIAMTX_ENABLED", True)
        with patch("cv.ffmpeg._probe_video_codec", return_value="hevc"):
            pub = FFmpegDirectPublisher(source_url="/data/video.mp4", stream_id="s1", loop=False)
            # Make all _spawn calls fail
            pub._spawn = MagicMock(return_value=False)
            result = pub.start()
        assert result is False
        assert pub.enabled is False

    def test_close_terminates_process(self):
        pub = FFmpegDirectPublisher(source_url="video.mp4", stream_id="s1")
        from tests.fakes import FakePopen
        pub.process = FakePopen()
        assert pub.is_alive() is True
        pub.close()
        assert pub.process is None

    def test_is_alive_false_when_no_process(self):
        pub = FFmpegDirectPublisher(source_url="video.mp4", stream_id="s1")
        assert pub.is_alive() is False

    def test_spawn_file_not_found_disables(self, monkeypatch):
        monkeypatch.setattr("cv.ffmpeg.MEDIAMTX_ENABLED", True)
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_BIN", "/nonexistent/ffmpeg")
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_SCALE_WIDTH", 0)
        monkeypatch.setattr("cv.ffmpeg.FFMPEG_SCALE_HEIGHT", 0)
        pub = FFmpegDirectPublisher(source_url="/data/video.mp4", stream_id="s1")
        result = pub._spawn(use_copy=True)
        assert result is False
        assert pub.enabled is False
