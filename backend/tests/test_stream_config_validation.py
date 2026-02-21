"""StreamConfig Pydantic validation — ensures stream_id and source_url contracts."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from orchestrator.types import StreamConfig


class TestValidStreamIds:
    def test_alphanumeric_with_hyphens_underscores(self):
        cfg = StreamConfig(stream_id="my-stream_1", source_url="rtsp://host/live")
        assert cfg.stream_id == "my-stream_1"

    def test_single_character(self):
        cfg = StreamConfig(stream_id="a", source_url="rtsp://host/live")
        assert cfg.stream_id == "a"

    def test_all_digits(self):
        cfg = StreamConfig(stream_id="12345", source_url="rtsp://host/live")
        assert cfg.stream_id == "12345"


class TestInvalidStreamIds:
    def test_empty_string(self):
        with pytest.raises(ValidationError):
            StreamConfig(stream_id="", source_url="rtsp://host/live")

    def test_spaces(self):
        with pytest.raises(ValidationError):
            StreamConfig(stream_id="my stream", source_url="rtsp://host/live")

    def test_path_traversal(self):
        with pytest.raises(ValidationError):
            StreamConfig(stream_id="../../etc", source_url="rtsp://host/live")

    def test_dots(self):
        with pytest.raises(ValidationError):
            StreamConfig(stream_id="stream.name", source_url="rtsp://host/live")

    def test_unicode(self):
        with pytest.raises(ValidationError):
            StreamConfig(stream_id="\u00f6stream", source_url="rtsp://host/live")

    def test_slashes(self):
        with pytest.raises(ValidationError):
            StreamConfig(stream_id="a/b", source_url="rtsp://host/live")


class TestSourceUrl:
    def test_empty_source_url_rejected(self):
        with pytest.raises(ValidationError):
            StreamConfig(stream_id="x", source_url="")


class TestLoopDefault:
    def test_defaults_to_true(self):
        cfg = StreamConfig(stream_id="x", source_url="rtsp://host/live")
        assert cfg.loop is True

    def test_can_be_false(self):
        cfg = StreamConfig(stream_id="x", source_url="rtsp://host/live", loop=False)
        assert cfg.loop is False
