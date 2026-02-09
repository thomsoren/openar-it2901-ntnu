"""
RT-DETR boat detector.
"""
from pathlib import Path
from typing import List

import numpy as np
from ultralytics import RTDETR

from common import settings
from common.types import Detection


class RTDETRDetector:
    DEFAULT_MODEL = "rtdetr-l.pt"
    BOAT_CLASSES = {8}  # 8 = boat in COCO

    def __init__(
        self,
        model_path: str | None = None,
        confidence: float = 0.25,
        filter_boats: bool = True,  # Only return boat detections
    ):
        self.confidence = confidence
        self.filter_boats = filter_boats
        self.model = self._load_model(model_path)

    def _load_model(self, model_path: str | None) -> RTDETR:
        if model_path:
            path = Path(model_path)
            if path.exists():
                return RTDETR(str(path))

            models_path = settings.MODELS_DIR / model_path
            if models_path.exists():
                return RTDETR(str(models_path))

        default_path = settings.MODELS_DIR / self.DEFAULT_MODEL
        if default_path.exists():
            return RTDETR(str(default_path))

        return RTDETR(self.DEFAULT_MODEL)

    def detect(self, frame: np.ndarray, track: bool = False) -> List[Detection]:
        if track:
            results = self.model.track(
                frame,
                conf=self.confidence,
                iou=0.4,
                persist=True,
                tracker="bytetrack.yaml",
                verbose=False
            )[0]
        else:
            results = self.model(frame, conf=self.confidence, iou=0.4, verbose=False)[0]

        detections = []

        if results.boxes is None:
            return detections

        for box in results.boxes:
            class_id = int(box.cls[0])

            # Skip non-boat classes if filtering enabled
            if self.filter_boats and class_id not in self.BOAT_CLASSES:
                continue

            xyxy = box.xyxy[0].cpu().numpy()
            conf = float(box.conf[0])

            track_id = None
            if track and box.id is not None:
                track_id = int(box.id[0])

            class_name = results.names.get(class_id, "boat")

            w = xyxy[2] - xyxy[0]
            h = xyxy[3] - xyxy[1]

            detections.append(Detection(
                x=float(xyxy[0] + w / 2),
                y=float(xyxy[1] + h / 2),
                width=float(w),
                height=float(h),
                confidence=conf,
                class_id=class_id,
                class_name=class_name,
                track_id=track_id,
            ))

        return detections


def get_detector(confidence: float = 0.25, model_path: str | None = None) -> RTDETRDetector:
    return RTDETRDetector(model_path=model_path, confidence=confidence)
