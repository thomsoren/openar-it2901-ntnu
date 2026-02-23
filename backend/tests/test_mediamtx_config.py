"""Tests for MediaMTX URL construction, auth embedding, and channel naming."""
from __future__ import annotations

from common.config.mediamtx import (
    _with_basic_auth,
    build_playback_urls,
    build_rtsp_publish_url,
)
from common.config.redis import detections_channel


# ---------- RTSP publish URL ----------

class TestRtspPublishUrl:
    def test_default_no_auth(self, monkeypatch):
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_RTSP_BASE", "rtsp://localhost:8854")
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_PUBLISH_USER", "")
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_PUBLISH_PASS", "")
        url = build_rtsp_publish_url("cam-1")
        assert url == "rtsp://localhost:8854/cam-1"

    def test_with_credentials(self, monkeypatch):
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_RTSP_BASE", "rtsp://localhost:8854")
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_PUBLISH_USER", "pub")
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_PUBLISH_PASS", "secret")
        url = build_rtsp_publish_url("cam-1")
        assert "pub:secret@" in url
        assert url.endswith("/cam-1")


# ---------- Playback URLs ----------

class TestPlaybackUrls:
    def test_has_all_keys(self, monkeypatch):
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_INCLUDE_READ_CREDENTIALS_IN_URLS", False)
        urls = build_playback_urls("test")
        assert "whep_url" in urls
        assert "hls_url" in urls
        assert "rtsp_url" in urls

    def test_whep_path(self, monkeypatch):
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_WHEP_BASE", "http://localhost:8889")
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_INCLUDE_READ_CREDENTIALS_IN_URLS", False)
        urls = build_playback_urls("s1")
        assert urls["whep_url"].endswith("/s1/whep")

    def test_hls_path(self, monkeypatch):
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_HLS_BASE", "http://localhost:8888")
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_INCLUDE_READ_CREDENTIALS_IN_URLS", False)
        urls = build_playback_urls("s1")
        assert urls["hls_url"].endswith("/s1/index.m3u8")

    def test_no_read_credentials_by_default(self, monkeypatch):
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_INCLUDE_READ_CREDENTIALS_IN_URLS", False)
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_READ_USER", "reader")
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_READ_PASS", "pass")
        urls = build_playback_urls("s1")
        assert "reader" not in urls["whep_url"]
        assert "reader" not in urls["hls_url"]

    def test_with_read_credentials_when_enabled(self, monkeypatch):
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_INCLUDE_READ_CREDENTIALS_IN_URLS", True)
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_READ_USER", "reader")
        monkeypatch.setattr("common.config.mediamtx.MEDIAMTX_READ_PASS", "pass")
        urls = build_playback_urls("s1")
        assert "reader:pass@" in urls["whep_url"]
        assert "reader:pass@" in urls["hls_url"]
        assert "reader:pass@" in urls["rtsp_url"]


# ---------- _with_basic_auth ----------

class TestWithBasicAuth:
    def test_user_and_password(self):
        url = _with_basic_auth("rtsp://host:8854/path", "user", "pass")
        assert url == "rtsp://user:pass@host:8854/path"

    def test_user_only_no_password(self):
        url = _with_basic_auth("rtsp://host:8854/path", "user", "")
        assert url == "rtsp://user@host:8854/path"

    def test_empty_both_returns_unchanged(self):
        original = "rtsp://host:8854/path"
        assert _with_basic_auth(original, "", "") == original


# ---------- Detection channel naming ----------

class TestDetectionsChannel:
    def test_format(self):
        assert detections_channel("my-stream") == "detections:my-stream"

    def test_custom_prefix(self, monkeypatch):
        monkeypatch.setattr("common.config.redis.REDIS_DETECTIONS_CHANNEL_PREFIX", "det")
        assert detections_channel("s1") == "det:s1"
