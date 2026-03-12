"""RT-DETR detector for IDUN inference worker.

Self-contained version of backend/cv/detectors.py that runs without
the full backend dependency tree. Accepts model path and config as
constructor arguments instead of importing from backend config modules.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import List

import numpy as np
import torch
from pydantic import BaseModel
from ultralytics import RTDETR
from ultralytics.trackers.byte_tracker import BYTETracker

logger = logging.getLogger(__name__)

# Defaults matching backend/cv/config.py
DEFAULT_CONFIDENCE = 0.25
DEFAULT_IOU_THRESHOLD = 0.45
BYTETRACK_YAML = Path(__file__).parent / "bytetrack.yaml"

# ByteTrack defaults matching the YAML
_DEFAULT_FRAME_RATE = 30


class Detection(BaseModel):
    """Bounding box from RT-DETR detection."""

    x: float
    y: float
    width: float
    height: float
    confidence: float
    class_id: int | None = None
    class_name: str | None = "boat"
    track_id: int | None = None


class _TrackerArgs:
    """Namespace matching what BYTETracker expects from its args parameter."""

    track_high_thresh = 0.5
    track_low_thresh = 0.2
    new_track_thresh = 0.6
    track_buffer = 30
    match_thresh = 0.8
    fuse_score = True


class RTDETRDetector:
    """RT-DETR boat detector for IDUN."""

    # best.pt is a custom single-class model where all 10 class indices map to
    # vessel detections. This set accepts every class the model can produce.
    BOAT_CLASSES = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9}

    def __init__(
        self,
        model_path: str = "best.pt",
        confidence: float = DEFAULT_CONFIDENCE,
        iou_threshold: float = DEFAULT_IOU_THRESHOLD,
    ) -> None:
        self.confidence = confidence
        self.iou_threshold = iou_threshold
        self._use_half = False
        self.model = self._load_model(model_path)
        self._trackers: dict[str, BYTETracker] = {}

    def _load_model(self, model_path: str) -> RTDETR:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        self._use_half = device == "cuda"
        logger.info("Device: %s", device)

        path = Path(model_path)
        if path.exists():
            logger.info("Loading model from: %s", path)
            return RTDETR(str(path))

        logger.info("Loading model: %s", model_path)
        return RTDETR(model_path)

    def detect(self, frame: np.ndarray, track: bool = False) -> List[Detection]:
        half = self._use_half
        if track:
            results = self.model.track(
                frame,
                conf=self.confidence,
                iou=self.iou_threshold,
                imgsz=640,
                half=half,
                persist=True,
                tracker=str(BYTETRACK_YAML),
                agnostic_nms=True,
                verbose=False,
            )[0]
        else:
            results = self.model(
                frame,
                conf=self.confidence,
                iou=self.iou_threshold,
                imgsz=640,
                half=half,
                agnostic_nms=True,
                verbose=False,
            )[0]

        detections = []
        boxes = results.boxes
        if boxes is None or len(boxes) == 0:
            return detections

        xyxy_all = boxes.xyxy.cpu().numpy()
        conf_all = boxes.conf.cpu().numpy()
        cls_all = boxes.cls.cpu().numpy().astype(int)
        ids_all = (
            boxes.id.cpu().numpy().astype(int)
            if track and boxes.id is not None
            else None
        )

        for i in range(len(xyxy_all)):
            class_id = int(cls_all[i])
            if class_id not in self.BOAT_CLASSES:
                continue

            xyxy = xyxy_all[i]
            w = xyxy[2] - xyxy[0]
            h = xyxy[3] - xyxy[1]
            track_id = int(ids_all[i]) if ids_all is not None else None
            class_name = results.names.get(class_id, "boat")

            detections.append(Detection(
                x=float(xyxy[0] + w / 2),
                y=float(xyxy[1] + h / 2),
                width=float(w),
                height=float(h),
                confidence=float(conf_all[i]),
                class_id=class_id,
                class_name=class_name,
                track_id=track_id,
            ))

        return detections

    def reset_tracker(self) -> None:
        """Reset ByteTrack state so track IDs restart for a new stream."""
        try:
            predictor = getattr(self.model, "predictor", None)
            if predictor is not None and hasattr(predictor, "trackers"):
                for tracker in predictor.trackers:
                    if tracker is not None and hasattr(tracker, "reset"):
                        tracker.reset()
        except Exception as exc:
            logger.debug("Tracker reset failed (non-critical): %s", exc)

    def predict_batch(self, frames: list[np.ndarray]) -> list:
        """Run RT-DETR on a batch of frames without tracking.

        Returns a list of raw ultralytics Results objects (one per frame).
        Callers handle per-stream tracking via update_tracker().
        """
        if not frames:
            return []
        return self.model.predict(
            frames,
            conf=self.confidence,
            iou=self.iou_threshold,
            imgsz=640,
            half=self._use_half,
            agnostic_nms=True,
            verbose=False,
        )

    @staticmethod
    def _boxes_for_tracking(boxes: object) -> object:
        """Normalize tracker input to host memory when detections live on an accelerator."""
        cpu = getattr(boxes, "cpu", None)
        return cpu() if callable(cpu) else boxes

    def update_tracker(self, stream_id: str, results: object) -> List[Detection]:
        """Run per-stream ByteTrack on a single ultralytics Results object.

        Creates a tracker for the stream on first call. Returns tracked
        detections with persistent track IDs.
        """
        if stream_id not in self._trackers:
            self._trackers[stream_id] = BYTETracker(
                _TrackerArgs(), frame_rate=_DEFAULT_FRAME_RATE
            )
        tracker = self._trackers[stream_id]

        boxes = results.boxes
        names = results.names

        if boxes is None or len(boxes) == 0:
            tracker.frame_id += 1
            return []

        tracked = tracker.update(self._boxes_for_tracking(boxes), None)
        if len(tracked) == 0:
            return []

        detections: List[Detection] = []
        for row in tracked:
            x1, y1, x2, y2 = float(row[0]), float(row[1]), float(row[2]), float(row[3])
            track_id = int(row[4])
            score = float(row[5])
            class_id = int(row[6])

            if class_id not in self.BOAT_CLASSES:
                continue

            w = x2 - x1
            h = y2 - y1
            class_name = names.get(class_id, "boat")

            detections.append(Detection(
                x=x1 + w / 2,
                y=y1 + h / 2,
                width=w,
                height=h,
                confidence=score,
                class_id=class_id,
                class_name=class_name,
                track_id=track_id,
            ))

        return detections

    def reset_tracker_for_stream(self, stream_id: str) -> None:
        """Remove the per-stream ByteTrack tracker so IDs restart."""
        self._trackers.pop(stream_id, None)
