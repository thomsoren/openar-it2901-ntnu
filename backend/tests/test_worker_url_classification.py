"""Tests for URL classification utilities in cv.utils."""
from __future__ import annotations

from cv.utils import is_remote_url


class TestRemoteUrls:
    def test_rtsp(self):
        assert is_remote_url("rtsp://192.168.1.1/stream") is True

    def test_rtsps(self):
        assert is_remote_url("rtsps://secure.cam/stream") is True

    def test_http(self):
        assert is_remote_url("http://example.com/feed.m3u8") is True

    def test_https(self):
        assert is_remote_url("https://secure.cam/live") is True

    def test_rtmp(self):
        assert is_remote_url("rtmp://stream.server/live") is True

    def test_udp(self):
        assert is_remote_url("udp://239.0.0.1:1234") is True

    def test_tcp(self):
        assert is_remote_url("tcp://host:5000") is True


class TestLocalUrls:
    def test_unix_file_path(self):
        assert is_remote_url("/data/video.mp4") is False

    def test_windows_file_path(self):
        assert is_remote_url("C:\\Users\\video.mp4") is False

    def test_relative_path(self):
        assert is_remote_url("data/video.mp4") is False

    def test_empty_string(self):
        assert is_remote_url("") is False

    def test_file_scheme(self):
        assert is_remote_url("file:///data/video.mp4") is False
