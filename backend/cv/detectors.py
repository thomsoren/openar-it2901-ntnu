"""RT-DETR boat detector."""
from __future__ import annotations

import logging
import threading
from pathlib import Path

import numpy as np
import torch
from ultralytics import RTDETR

from common.config import MODELS_DIR
from common.types import Detection
from cv.config import (
    CONFIDENCE,
    DETECTOR_DEVICE,
    IOU_THRESHOLD,
    AGNOSTIC_NMS,
    BYTETRACK_YAML,
    MODEL_INPUT_SIZE,
)

logger = logging.getLogger(__name__)


class RTDETRDetector:
    DEFAULT_MODEL = "optuna_model.pt"
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
        self.device = "cpu"
        self._use_half = False
        self._logged_runtime_device = False
        self.model = self._load_model(model_path)

    def _select_device(self) -> str:
        """Select PyTorch device. Uses DETECTOR_DEVICE env if set, else auto: CUDA > MPS > CPU."""
        if DETECTOR_DEVICE:
            if DETECTOR_DEVICE == "cuda" and torch.cuda.is_available():
                logger.info("DETECTOR_DEVICE=cuda: %s", torch.cuda.get_device_name(0))
                return "cuda"
            if DETECTOR_DEVICE == "mps" and hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                logger.info("DETECTOR_DEVICE=mps: Using Apple MPS (Metal Performance Shaders)")
                return "mps"
            if DETECTOR_DEVICE == "cpu":
                logger.info("DETECTOR_DEVICE=cpu: Using CPU")
                return "cpu"
            logger.warning("DETECTOR_DEVICE=%s not available, falling back to auto", DETECTOR_DEVICE)
        if torch.cuda.is_available():
            logger.info("CUDA device: %s", torch.cuda.get_device_name(0))
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            logger.info("Using Apple MPS (Metal Performance Shaders)")
            return "mps"
        return "cpu"

    def _load_model(self, model_path: str | None) -> RTDETR:
        device = self._select_device()
        self.device = device
        self._use_half = device == "cuda"
        self._device = device
        logger.info("PyTorch device: %s", device)

        if model_path:
            path = Path(model_path)
            if path.exists():
                logger.info("Loading model from: %s", path)
                return RTDETR(str(path))

            models_path = MODELS_DIR / model_path
            if models_path.exists():
                logger.info("Loading model from: %s", models_path)
                return RTDETR(str(models_path))

        default_path = MODELS_DIR / self.DEFAULT_MODEL
        if default_path.exists():
            logger.info("Loading model from: %s", default_path)
            return RTDETR(str(default_path))

        logger.info("Loading default model: %s", self.DEFAULT_MODEL)
        return RTDETR(self.DEFAULT_MODEL)

    def detect(self, frame: np.ndarray, track: bool = False) -> list[Detection]:
        half = self._use_half
        if track:
            results = self.model.track(
                frame,
                device=self._device,
                conf=self.confidence,
                iou=IOU_THRESHOLD,
                imgsz=MODEL_INPUT_SIZE,
                half=half,
                persist=True,
                tracker=str(BYTETRACK_YAML),
                agnostic_nms=AGNOSTIC_NMS,
                verbose=False,
            )[0]
        else:
            results = self.model(
                frame,
                device=self._device,
                conf=self.confidence,
                iou=IOU_THRESHOLD,
                imgsz=MODEL_INPUT_SIZE,
                half=half,
                agnostic_nms=AGNOSTIC_NMS,
                verbose=False,
            )[0]

        detections = []
        boxes = results.boxes
        if boxes is None or len(boxes) == 0:
            return detections
        if not self._logged_runtime_device and boxes.data is not None:
            logger.info("Detection tensors are on device: %s", boxes.data.device)
            self._logged_runtime_device = True

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


_shared_detector_lock = threading.Lock()
_shared_detector: RTDETRDetector | None = None


def get_shared_detector() -> RTDETRDetector:
    """Return a process-wide singleton RTDETRDetector.

    Thread-safe via double-checked locking. The model is loaded once on first
    call and reused for all subsequent calls.
    """
    global _shared_detector
    if _shared_detector is not None:
        return _shared_detector
    with _shared_detector_lock:
        if _shared_detector is None:
            _shared_detector = RTDETRDetector()
        return _shared_detector
