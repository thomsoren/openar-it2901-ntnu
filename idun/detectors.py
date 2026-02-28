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

logger = logging.getLogger(__name__)

# Defaults matching backend/cv/config.py
DEFAULT_CONFIDENCE = 0.25
DEFAULT_IOU_THRESHOLD = 0.45
BYTETRACK_YAML = Path(__file__).parent / "bytetrack.yaml"


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


class RTDETRDetector:
    """RT-DETR boat detector for IDUN."""

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
