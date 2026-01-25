"""
Multi-Object Tracking (MOT) using ByteTrack.
"""
import numpy as np
import cv2
from typing import List, Tuple
from common.types import Detection

class KalmanBoxTracker:
    count = 0
    def __init__(self, bbox: np.ndarray):
        self.kf = cv2.KalmanFilter(7, 4)
        self.kf.transitionMatrix = np.array([
            [1,0,0,0,1,0,0], [0,1,0,0,0,1,0], [0,0,1,0,0,0,1], [0,0,0,1,0,0,0],
            [0,0,0,0,1,0,0], [0,0,0,0,0,1,0], [0,0,0,0,0,0,1]
        ], dtype=np.float32)
        self.kf.measurementMatrix = np.array([
            [1,0,0,0,0,0,0], [0,1,0,0,0,0,0], [0,0,1,0,0,0,0], [0,0,0,1,0,0,0]
        ], dtype=np.float32)
        self.kf.processNoiseCov = np.eye(7, dtype=np.float32) * 0.01
        self.kf.measurementNoiseCov = np.eye(4, dtype=np.float32) * 1.0
        self.kf.errorCovPost = np.eye(7, dtype=np.float32)
        
        z = self._bbox_to_z(bbox)
        self.kf.statePost = np.array([[z[0]], [z[1]], [z[2]], [z[3]], [0], [0], [0]], dtype=np.float32)
        
        self.id = KalmanBoxTracker.count
        KalmanBoxTracker.count += 1
        self.time_since_update = 0
        self.hits = 1
        self.age = 0
        self.confidence = 0.0
        self.class_id = None
        self.class_name = "boat"

    def _bbox_to_z(self, bbox: np.ndarray) -> np.ndarray:
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        return np.array([bbox[0] + w/2, bbox[1] + h/2, w*h, w/max(h, 1e-6)])

    def predict(self) -> np.ndarray:
        self.kf.predict()
        self.age += 1
        self.time_since_update += 1
        return self.get_state()

    def update(self, bbox: np.ndarray, confidence: float, class_id: int = None, class_name: str = "boat"):
        self.time_since_update = 0
        self.hits += 1
        self.confidence = confidence
        self.class_id = class_id
        self.class_name = class_name
        z = self._bbox_to_z(bbox).reshape(4, 1).astype(np.float32)
        self.kf.correct(z)

    def get_state(self) -> np.ndarray:
        z = self.kf.statePost[:4, 0]
        w = np.sqrt(max(z[2] * z[3], 1e-6))
        h = max(z[2] / max(w, 1e-6), 1e-6)
        return np.array([z[0] - w/2, z[1] - h/2, z[0] + w/2, z[1] + h/2])

def compute_iou(bbox1: np.ndarray, bbox2: np.ndarray) -> float:
    x1 = max(bbox1[0], bbox2[0])
    y1 = max(bbox1[1], bbox2[1])
    x2 = min(bbox1[2], bbox2[2])
    y2 = min(bbox1[3], bbox2[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    area1 = (bbox1[2]-bbox1[0]) * (bbox1[3]-bbox1[1])
    area2 = (bbox2[2]-bbox2[0]) * (bbox2[3]-bbox2[1])
    return inter / max(area1 + area2 - inter, 1e-6)

class ByteTracker:
    def __init__(self, track_thresh=0.5, det_thresh=0.1, buffer=30, iou_thresh=0.7):
        self.track_thresh = track_thresh
        self.det_thresh = det_thresh
        self.buffer = buffer
        self.iou_thresh = iou_thresh
        self.trackers: List[KalmanBoxTracker] = []
        self.frame_id = 0

    def update(self, detections: List[Detection]) -> List[Detection]:
        self.frame_id += 1
        
        # Convert Detection objects to internal format [x1, y1, x2, y2]
        high_dets = []
        low_dets = []
        for d in detections:
            bbox = np.array([d.x - d.width/2, d.y - d.height/2, d.x + d.width/2, d.y + d.height/2])
            if d.confidence >= self.track_thresh:
                high_dets.append((bbox, d))
            elif d.confidence >= self.det_thresh:
                low_dets.append((bbox, d))

        for t in self.trackers:
            t.predict()

        # Simple association logic
        matched_indices = []
        if self.trackers and high_dets:
            ious = np.zeros((len(self.trackers), len(high_dets)))
            for i, t in enumerate(self.trackers):
                for j, (bbox, _) in enumerate(high_dets):
                    ious[i, j] = compute_iou(t.get_state(), bbox)
            
            # Greedy matching for simplicity
            for i in range(len(self.trackers)):
                best_j = np.argmax(ious[i])
                if ious[i, best_j] >= self.iou_thresh:
                    bbox, d = high_dets[best_j]
                    self.trackers[i].update(bbox, d.confidence, d.class_id, d.class_name)
                    matched_indices.append(best_j)

        # New trackers for unmatched high detections
        for j, (bbox, d) in enumerate(high_dets):
            if j not in matched_indices:
                self.trackers.append(KalmanBoxTracker(bbox))
                self.trackers[-1].update(bbox, d.confidence, d.class_id, d.class_name)

        # Clean up old tracks
        self.trackers = [t for t in self.trackers if t.time_since_update <= self.buffer]

        # Return tracked results as Detection objects
        results = []
        for t in self.trackers:
            if t.time_since_update <= 1 and t.hits >= 3:
                bbox = t.get_state()
                w, h = bbox[2]-bbox[0], bbox[3]-bbox[1]
                results.append(Detection(
                    x=float(bbox[0] + w/2),
                    y=float(bbox[1] + h/2),
                    width=float(w),
                    height=float(h),
                    confidence=t.confidence,
                    class_id=t.class_id,
                    class_name=t.class_name,
                    track_id=t.id
                ))
        return results
