"""
Unified boat detectors (YOLO & Roboflow).
"""
import os
from typing import List, Optional
import numpy as np
from ultralytics import YOLO
from common.types import Detection
from common import settings

class BaseDetector:
    def detect(self, frame: np.ndarray) -> List[Detection]:
        raise NotImplementedError

class YOLODetector(BaseDetector):
    """Local YOLOv8 detector."""
    BOAT_CLASS_ID = 8

    def __init__(self, model_path: str = "yolov8s.pt", confidence: float = 0.25):
        # Try to find model in cv/models
        full_path = settings.MODELS_DIR / model_path
        if not full_path.exists():
            # Fallback to model name (ultralytics will download)
            self.model = YOLO(model_path)
        else:
            self.model = YOLO(str(full_path))
            
        self.confidence = confidence

    def detect(self, frame: np.ndarray) -> List[Detection]:
        results = self.model(frame, conf=self.confidence, verbose=False)[0]
        detections = []
        
        if results.boxes is None:
            return detections

        for box in results.boxes:
            class_id = int(box.cls[0])
            # Filter for boats (class 8 in COCO)
            if class_id == self.BOAT_CLASS_ID:
                xyxy = box.xyxy[0].cpu().numpy()
                conf = float(box.conf[0])
                
                w = xyxy[2] - xyxy[0]
                h = xyxy[3] - xyxy[1]
                
                detections.append(Detection(
                    x=float(xyxy[0] + w / 2),
                    y=float(xyxy[1] + h / 2),
                    width=float(w),
                    height=float(h),
                    confidence=conf,
                    class_id=class_id,
                    class_name="boat"
                ))
        return detections

class RoboflowDetector(BaseDetector):
    """Roboflow Inference SDK detector."""
    def __init__(self, model_id: str = "boat-detection-model/1", confidence: float = 0.3):
        try:
            from inference_sdk import InferenceHTTPClient
        except ImportError:
            raise ImportError("inference-sdk not installed")
            
        api_key = os.getenv("ROBOFLOW_API_KEY")
        self.client = InferenceHTTPClient(
            api_url="http://localhost:9001",
            api_key=api_key
        )
        self.model_id = model_id
        self.confidence = confidence

    def detect(self, frame: np.ndarray) -> List[Detection]:
        result = self.client.infer(frame, model_id=self.model_id)
        detections = []
        
        for pred in result.get('predictions', []):
            if pred['confidence'] < self.confidence:
                continue
                
            detections.append(Detection(
                x=float(pred['x']),
                y=float(pred['y']),
                width=float(pred['width']),
                height=float(pred['height']),
                confidence=float(pred['confidence']),
                class_id=pred.get('class_id'),
                class_name=pred.get('class', 'boat')
            ))
        return detections

def get_detector(detector_type: str = "yolo", **kwargs) -> BaseDetector:
    if detector_type == "yolo":
        return YOLODetector(**kwargs)
    elif detector_type == "roboflow":
        return RoboflowDetector(**kwargs)
    else:
        raise ValueError(f"Unknown detector type: {detector_type}")
