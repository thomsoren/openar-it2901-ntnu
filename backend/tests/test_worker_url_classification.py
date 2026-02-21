"""Tests for _is_remote_stream_url — classifies source URLs as remote or local."""
from __future__ import annotations

from cv.worker import _is_remote_stream_url


class TestRemoteUrls:
    def test_rtsp(self):
        assert _is_remote_stream_url("rtsp://192.168.1.1/stream") is True

    def test_http(self):
        assert _is_remote_stream_url("http://example.com/feed.m3u8") is True

    def test_https(self):
        assert _is_remote_stream_url("https://secure.cam/live") is True

    def test_rtmp(self):
        assert _is_remote_stream_url("rtmp://stream.server/live") is True

    def test_udp(self):
        assert _is_remote_stream_url("udp://239.0.0.1:1234") is True

    def test_tcp(self):
        assert _is_remote_stream_url("tcp://host:5000") is True


class TestLocalUrls:
    def test_unix_file_path(self):
        assert _is_remote_stream_url("/data/video.mp4") is False

    def test_windows_file_path(self):
        assert _is_remote_stream_url("C:\\Users\\video.mp4") is False

    def test_relative_path(self):
        assert _is_remote_stream_url("data/video.mp4") is False

    def test_empty_string(self):
        assert _is_remote_stream_url("") is False

    def test_file_scheme(self):
        assert _is_remote_stream_url("file:///data/video.mp4") is False
