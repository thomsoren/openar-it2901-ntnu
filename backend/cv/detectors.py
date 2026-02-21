"""
RT-DETR boat detector.
"""
from pathlib import Path
from typing import List

import numpy as np
import torch
from ultralytics import RTDETR

from common.config import MODELS_DIR
from common.types import Detection
from cv.config import CONFIDENCE, IOU_THRESHOLD, AGNOSTIC_NMS, BYTETRACK_YAML


class RTDETRDetector:
    DEFAULT_MODEL = "best.pt"  # Custom trained on CombinedShips
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
        self._use_half = False
        self.model = self._load_model(model_path)

    def _load_model(self, model_path: str | None) -> RTDETR:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        self._use_half = device == "cuda"
        print(f"[Detector] PyTorch device: {device}")
        if device == "cuda":
            print(f"[Detector] CUDA device: {torch.cuda.get_device_name(0)}")

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
        half = self._use_half
        if track:
            results = self.model.track(
                frame,
                conf=self.confidence,
                iou=IOU_THRESHOLD,
                imgsz=640,
                half=half,
                persist=True,
                tracker=str(BYTETRACK_YAML),
                agnostic_nms=AGNOSTIC_NMS,
                verbose=False,
            )[0]
        else:
            results = self.model(
                frame,
                conf=self.confidence,
                iou=IOU_THRESHOLD,
                imgsz=640,
                half=half,
                agnostic_nms=AGNOSTIC_NMS,
                verbose=False,
            )[0]

        detections = []
        boxes = results.boxes
        if boxes is None or len(boxes) == 0:
            return detections

        # Batch GPU→CPU transfer: one PCIe round-trip instead of per-box
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

            if self.filter_boats and class_id not in self.BOAT_CLASSES:
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


def get_detector(confidence: float = CONFIDENCE, model_path: str | None = None) -> RTDETRDetector:
    return RTDETRDetector(model_path=model_path, confidence=confidence)
