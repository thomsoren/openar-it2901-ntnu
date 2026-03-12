"""Tests for detection data contracts — validates payload shapes and model roundtrips."""
from __future__ import annotations

from common.types import Detection, DetectedVessel, Vessel


def _sample_detection(**overrides) -> Detection:
    defaults = dict(x=100.0, y=200.0, width=50.0, height=60.0, confidence=0.85)
    defaults.update(overrides)
    return Detection(**defaults)


def _sample_vessel(**overrides) -> Vessel:
    defaults = dict(mmsi="123456789", name="Test Vessel", speed=12.5, heading=180.0)
    defaults.update(overrides)
    return Vessel(**defaults)


class TestDetectionModel:
    def test_has_all_fields(self):
        d = _sample_detection()
        dump = d.model_dump()
        for key in ("x", "y", "width", "height", "confidence", "class_id", "class_name", "track_id"):
            assert key in dump

    def test_model_dump_roundtrip(self):
        d = _sample_detection(track_id=7, class_id=1, class_name="boat")
        restored = Detection(**d.model_dump())
        assert restored == d

    def test_defaults(self):
        d = _sample_detection()
        assert d.class_name == "boat"
        assert d.class_id is None
        assert d.track_id is None


class TestDetectedVessel:
    def test_with_no_ais(self):
        dv = DetectedVessel(detection=_sample_detection(), vessel=None)
        assert dv.vessel is None
        assert dv.detection.confidence == 0.85

    def test_with_ais(self):
        dv = DetectedVessel(detection=_sample_detection(), vessel=_sample_vessel())
        assert dv.vessel is not None
        assert dv.vessel.mmsi == "123456789"


class TestPayloadShapes:
    """Validates the dict shapes produced by the worker for Redis/WebSocket delivery."""

    def test_ready_payload_shape(self):
        payload = {"type": "ready", "width": 1920, "height": 1080, "fps": 25.0}
        assert payload["type"] == "ready"
        assert isinstance(payload["width"], int)
        assert isinstance(payload["height"], int)
        assert isinstance(payload["fps"], float)

    def test_detection_payload_shape(self):
        d = _sample_detection(track_id=1)
        payload = {
            "type": "detections",
            "frame_index": 42,
            "timestamp_ms": 1680.0,
            "frame_sent_at_ms": 1000000.0,
            "fps": 25.0,
            "inference_fps": 18.3,
            "vessels": [{"detection": d.model_dump(), "vessel": None}],
        }
        assert payload["type"] == "detections"
        assert payload["frame_index"] >= 0
        assert payload["timestamp_ms"] >= 0.0
        assert "inference_fps" in payload
        assert "frame_sent_at_ms" in payload

    def test_vessel_entry_shape(self):
        d = _sample_detection()
        entry = {"detection": d.model_dump(), "vessel": None}
        assert "detection" in entry
        assert "vessel" in entry
        assert isinstance(entry["detection"], dict)
        assert entry["detection"]["x"] == 100.0
