"""
RT-DETR boat detector.
"""
from pathlib import Path
from typing import List

import numpy as np
from ultralytics import RTDETR

from common.config import MODELS_DIR
from common.types import Detection
from cv.config import CONFIDENCE, IOU_THRESHOLD, AGNOSTIC_NMS, BYTETRACK_YAML


class RTDETRDetector:
    DEFAULT_MODEL = "epoch50.pt"  # Custom trained on CombinedShips
    # All classes are boats in our custom model, no filtering needed
    BOAT_CLASSES = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9}

    def __init__(
        self,
        model_path: str | None = None,
        confidence: float = CONFIDENCE,
        filter_boats: bool = True,  # Only return boat detections
    ):
        self.confidence = confidence
        self.filter_boats = filter_boats
        self.model = self._load_model(model_path)

    def _load_model(self, model_path: str | None) -> RTDETR:
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"[Detector] PyTorch device: {device}")
            if device == "cuda":
                print(f"[Detector] CUDA device: {torch.cuda.get_device_name(0)}")
        except ImportError:
            print("[Detector] PyTorch not available for device check")

        if model_path:
            path = Path(model_path)
            if path.exists():
                print(f"[Detector] Loading model from: {path}")
                return RTDETR(str(path))

            models_path = MODELS_DIR / model_path
            if models_path.exists():
                print(f"[Detector] Loading model from: {models_path}")
                return RTDETR(str(models_path))

        default_path = MODELS_DIR / self.DEFAULT_MODEL
        if default_path.exists():
            print(f"[Detector] Loading model from: {default_path}")
            return RTDETR(str(default_path))

        print(f"[Detector] Loading default model: {self.DEFAULT_MODEL}")
        return RTDETR(self.DEFAULT_MODEL)

    def detect(self, frame: np.ndarray, track: bool = False) -> List[Detection]:
        if track:
            results = self.model.track(
                frame,
                conf=self.confidence,
                iou=IOU_THRESHOLD,
                persist=True,
                tracker=str(BYTETRACK_YAML),
                agnostic_nms=AGNOSTIC_NMS,
                verbose=False
            )[0]
        else:
            results = self.model(frame, conf=self.confidence, iou=IOU_THRESHOLD, agnostic_nms=AGNOSTIC_NMS, verbose=False)[0]

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


def get_detector(confidence: float = CONFIDENCE, model_path: str | None = None) -> RTDETRDetector:
    return RTDETRDetector(model_path=model_path, confidence=confidence)
