from __future__ import annotations

from cv.idun.noop_inference import NoopInferenceThread
from cv.performance import DecodedFrameTelemetry

import numpy as np


class StubDecodeThread:
    def __init__(self, stream_id: str = "s"):
        self.stream_id = stream_id
        self._fps = 25.0
        self._width = 640
        self._height = 480
        self.is_alive = True

    @property
    def fps(self) -> float:
        return self._fps

    @property
    def width(self) -> int:
        return self._width

    @property
    def height(self) -> int:
        return self._height

    def get_latest_telemetry(self) -> DecodedFrameTelemetry:
        return DecodedFrameTelemetry(
            frame=np.zeros((self._height, self._width, 3), dtype=np.uint8),
            frame_index=0,
            timestamp_ms=0.0,
            decoded_at_ms=0.0,
        )


def test_add_multiple_active_streams():
    noop = NoopInferenceThread()
    noop.add_active_stream("a")
    noop.add_active_stream("b")
    noop.add_active_stream("c")
    assert noop.get_active_streams() == {"a", "b", "c"}


def test_remove_active_stream():
    noop = NoopInferenceThread()
    noop.add_active_stream("a")
    noop.add_active_stream("b")
    noop.remove_active_stream("a")
    assert noop.get_active_streams() == {"b"}


def test_remove_nonexistent_stream_is_noop():
    noop = NoopInferenceThread()
    noop.add_active_stream("a")
    noop.remove_active_stream("x")
    assert noop.get_active_streams() == {"a"}


def test_set_active_stream_replaces_all():
    noop = NoopInferenceThread()
    noop.add_active_stream("a")
    noop.add_active_stream("b")
    noop.set_active_stream("c")
    assert noop.get_active_streams() == {"c"}


def test_set_active_stream_none_clears():
    noop = NoopInferenceThread()
    noop.add_active_stream("a")
    noop.set_active_stream(None)
    assert noop.get_active_streams() == set()


def test_get_active_stream_returns_one():
    noop = NoopInferenceThread()
    noop.add_active_stream("a")
    noop.add_active_stream("b")
    result = noop.get_active_stream()
    assert result in {"a", "b"}


def test_get_active_stream_returns_none_when_empty():
    noop = NoopInferenceThread()
    assert noop.get_active_stream() is None


def test_unregister_stream_removes_from_active():
    noop = NoopInferenceThread()
    dt = StubDecodeThread("a")
    noop.register_stream("a", dt)
    noop.add_active_stream("a")
    noop.add_active_stream("b")

    noop.unregister_stream("a")
    assert noop.get_active_streams() == {"b"}
    assert noop.get_decode_thread("a") is None


def test_register_and_get_decode_thread():
    noop = NoopInferenceThread()
    dt = StubDecodeThread("a")
    noop.register_stream("a", dt)
    assert noop.get_decode_thread("a") is dt
    assert noop.get_decode_thread("b") is None


def test_get_active_streams_returns_copy():
    noop = NoopInferenceThread()
    noop.add_active_stream("a")
    streams = noop.get_active_streams()
    streams.add("x")
    assert noop.get_active_streams() == {"a"}
