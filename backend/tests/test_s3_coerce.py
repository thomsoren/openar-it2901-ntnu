"""Tests for s3.coerce_s3_key."""
from __future__ import annotations

import pytest

from storage import s3


class TestCoerceS3Key:
    def test_s3_url_extracts_key(self):
        assert s3.coerce_s3_key("s3://bucket/videos/foo.mp4") == "bucket/videos/foo.mp4"
        assert s3.coerce_s3_key("s3://videos/foo.mp4") == "videos/foo.mp4"

    def test_raw_key_passthrough(self):
        assert s3.coerce_s3_key("videos/foo.mp4") == "videos/foo.mp4"
        assert s3.coerce_s3_key("  videos/foo.mp4  ") == "videos/foo.mp4"

    def test_strips_leading_slashes(self):
        assert s3.coerce_s3_key("s3:///videos/foo.mp4") == "videos/foo.mp4"
        assert s3.coerce_s3_key("/videos/foo.mp4") == "videos/foo.mp4"

    def test_empty_or_invalid_returns_none(self):
        assert s3.coerce_s3_key("") is None
        assert s3.coerce_s3_key("   ") is None
        assert s3.coerce_s3_key("s3://") is None
        assert s3.coerce_s3_key("s3://   ") is None
