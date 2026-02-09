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
    """
    RT-DETR detector for boat detection.

    Uses a trained RT-DETR model for real-time object detection.
    Falls back to pretrained model if custom weights not found.
    """

    DEFAULT_MODEL = "rtdetr-l.pt"

    def __init__(
        self,
        model_path: str | None = None,
        confidence: float = 0.25,
    ):
        """
        Initialize RT-DETR detector.

        Args:
            model_path: Path to model weights. If None, uses default.
            confidence: Minimum confidence threshold for detections.
        """
        self.confidence = confidence
        self.model = self._load_model(model_path)

    def _load_model(self, model_path: str | None) -> RTDETR:
        """Load RT-DETR model from path or use default."""
        if model_path:
            path = Path(model_path)
            if path.exists():
                return RTDETR(str(path))

            # Try models directory
            models_path = settings.MODELS_DIR / model_path
            if models_path.exists():
                return RTDETR(str(models_path))

        # Try default model in models directory
        default_path = settings.MODELS_DIR / self.DEFAULT_MODEL
        if default_path.exists():
            return RTDETR(str(default_path))

        # Fall back to downloading pretrained model
        return RTDETR(self.DEFAULT_MODEL)

    def detect(self, frame: np.ndarray) -> List[Detection]:
        """
        Run detection on a frame.

        Args:
            frame: BGR image as numpy array.

        Returns:
            List of Detection objects.
        """
        results = self.model(frame, conf=self.confidence, verbose=False)[0]
        detections = []

        if results.boxes is None:
            return detections

        for box in results.boxes:
            xyxy = box.xyxy[0].cpu().numpy()
            conf = float(box.conf[0])
            class_id = int(box.cls[0])

            # Get class name from model
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
            ))

        return detections


def get_detector(confidence: float = 0.25, model_path: str | None = None) -> RTDETRDetector:
    """
    Get the RT-DETR detector instance.

    Args:
        confidence: Minimum confidence threshold.
        model_path: Optional path to custom model weights.

    Returns:
        Configured RTDETRDetector instance.
    """
    return RTDETRDetector(model_path=model_path, confidence=confidence)
