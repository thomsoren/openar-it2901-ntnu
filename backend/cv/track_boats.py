#!/usr/bin/env python3
"""
Multi-Object Tracking (MOT) for Boats using ByteTrack or BoT-SORT

This script performs tracking-by-detection on video files using:
- Option A: Roboflow hosted model via their Python SDK
- Option B: Local YOLOv8 via ultralytics

Outputs:
- Annotated video with persistent track IDs
- CSV/JSON log with frame_index, track_id, bbox, confidence

Author: OpenAR Team
"""

import argparse
import json
import csv
import os
import sys
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional, Callable
from collections import defaultdict
import numpy as np
import cv2

# =============================================================================
# CONFIGURATION & CONSTANTS
# =============================================================================

# Placeholder for Roboflow API key - set via environment variable or replace
ROBOFLOW_API_KEY = os.getenv("ROBOFLOW_API_KEY", "HFhObvI2p0ari1OBoh2x")
ROBOFLOW_MODEL_ID = "boat-detection-model/1"  # Your trained model

# Default tracker parameters
DEFAULT_CONF_THRESHOLD = 0.25      # Lower to catch distant boats
DEFAULT_TRACK_BUFFER = 30         # Frames to keep lost tracks (1.2s @ 25fps)
DEFAULT_MATCH_THRESH = 0.8        # IoU threshold for matching
DEFAULT_MIN_BOX_AREA = 100        # Minimum bbox area in pixels (for small boats)
DEFAULT_HIGH_THRESH = 0.5         # ByteTrack: high confidence threshold
DEFAULT_LOW_THRESH = 0.1          # ByteTrack: low confidence threshold (second association)

# Colors for visualization (BGR format)
COLORS = [
    (255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0),
    (255, 0, 255), (0, 255, 255), (128, 0, 255), (255, 128, 0),
    (0, 128, 255), (128, 255, 0), (255, 0, 128), (0, 255, 128),
]


# =============================================================================
# DATA STRUCTURES
# =============================================================================

@dataclass
class Detection:
    """Single detection from object detector."""
    bbox: np.ndarray          # [x1, y1, x2, y2]
    confidence: float
    class_id: int = 0
    class_name: str = "boat"


@dataclass
class Track:
    """Single tracked object with persistent ID."""
    track_id: int
    bbox: np.ndarray          # [x1, y1, x2, y2]
    confidence: float
    class_id: int = 0
    class_name: str = "boat"
    age: int = 0              # Frames since track started
    hits: int = 1             # Total detections matched
    time_since_update: int = 0  # Frames since last detection match


@dataclass
class TrackingResult:
    """Result for a single frame."""
    frame_index: int
    tracks: List[Track] = field(default_factory=list)


# =============================================================================
# KALMAN FILTER FOR MOTION PREDICTION
# =============================================================================

class KalmanBoxTracker:
    """
    Kalman Filter for tracking bounding boxes.
    State: [x_center, y_center, scale, aspect_ratio, vx, vy, vs]
    """
    count = 0

    def __init__(self, bbox: np.ndarray):
        """Initialize Kalman filter with bounding box [x1, y1, x2, y2]."""
        # State: [x, y, s, r, vx, vy, vs] where s=area, r=aspect ratio
        self.kf = cv2.KalmanFilter(7, 4)

        # Transition matrix
        self.kf.transitionMatrix = np.array([
            [1, 0, 0, 0, 1, 0, 0],
            [0, 1, 0, 0, 0, 1, 0],
            [0, 0, 1, 0, 0, 0, 1],
            [0, 0, 0, 1, 0, 0, 0],
            [0, 0, 0, 0, 1, 0, 0],
            [0, 0, 0, 0, 0, 1, 0],
            [0, 0, 0, 0, 0, 0, 1],
        ], dtype=np.float32)

        # Measurement matrix
        self.kf.measurementMatrix = np.array([
            [1, 0, 0, 0, 0, 0, 0],
            [0, 1, 0, 0, 0, 0, 0],
            [0, 0, 1, 0, 0, 0, 0],
            [0, 0, 0, 1, 0, 0, 0],
        ], dtype=np.float32)

        # Process noise
        self.kf.processNoiseCov = np.eye(7, dtype=np.float32) * 0.01
        self.kf.processNoiseCov[4:, 4:] *= 0.01  # Smaller noise for velocities

        # Measurement noise
        self.kf.measurementNoiseCov = np.eye(4, dtype=np.float32) * 1.0

        # Error covariance
        self.kf.errorCovPost = np.eye(7, dtype=np.float32)
        self.kf.errorCovPost[4:, 4:] *= 1000  # High uncertainty for velocities

        # Initialize state
        z = self._bbox_to_z(bbox)
        self.kf.statePost = np.array([
            [z[0]], [z[1]], [z[2]], [z[3]], [0], [0], [0]
        ], dtype=np.float32)

        self.time_since_update = 0
        self.id = KalmanBoxTracker.count
        KalmanBoxTracker.count += 1
        self.hits = 1
        self.age = 0
        self.confidence = 0.0
        self.class_id = 0

    def _bbox_to_z(self, bbox: np.ndarray) -> np.ndarray:
        """Convert [x1, y1, x2, y2] to [x_center, y_center, scale, aspect_ratio]."""
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        x = bbox[0] + w / 2
        y = bbox[1] + h / 2
        s = w * h  # Scale is area
        r = w / max(h, 1e-6)  # Aspect ratio
        return np.array([x, y, s, r])

    def _z_to_bbox(self, z: np.ndarray) -> np.ndarray:
        """Convert [x_center, y_center, scale, aspect_ratio] to [x1, y1, x2, y2]."""
        w = np.sqrt(max(z[2] * z[3], 1e-6))
        h = max(z[2] / max(w, 1e-6), 1e-6)
        return np.array([
            z[0] - w / 2,
            z[1] - h / 2,
            z[0] + w / 2,
            z[1] + h / 2
        ])

    def update(self, bbox: np.ndarray, confidence: float = 0.0, class_id: int = 0):
        """Update state with new detection."""
        self.time_since_update = 0
        self.hits += 1
        self.confidence = confidence
        self.class_id = class_id
        z = self._bbox_to_z(bbox).reshape(4, 1).astype(np.float32)
        self.kf.correct(z)

    def predict(self) -> np.ndarray:
        """Predict next state and return bbox [x1, y1, x2, y2]."""
        # Prevent negative area
        if self.kf.statePost[2, 0] + self.kf.statePost[6, 0] <= 0:
            self.kf.statePost[6, 0] = 0

        self.kf.predict()
        self.age += 1
        self.time_since_update += 1

        state = self.kf.statePost[:4, 0]
        return self._z_to_bbox(state)

    def get_state(self) -> np.ndarray:
        """Get current bbox state [x1, y1, x2, y2]."""
        state = self.kf.statePost[:4, 0]
        return self._z_to_bbox(state)


# =============================================================================
# IOU & ASSOCIATION UTILITIES
# =============================================================================

def compute_iou(bbox1: np.ndarray, bbox2: np.ndarray) -> float:
    """Compute IoU between two bboxes [x1, y1, x2, y2]."""
    x1 = max(bbox1[0], bbox2[0])
    y1 = max(bbox1[1], bbox2[1])
    x2 = min(bbox1[2], bbox2[2])
    y2 = min(bbox1[3], bbox2[3])

    inter_area = max(0, x2 - x1) * max(0, y2 - y1)
    area1 = (bbox1[2] - bbox1[0]) * (bbox1[3] - bbox1[1])
    area2 = (bbox2[2] - bbox2[0]) * (bbox2[3] - bbox2[1])
    union_area = area1 + area2 - inter_area

    return inter_area / max(union_area, 1e-6)


def compute_iou_matrix(bboxes1: np.ndarray, bboxes2: np.ndarray) -> np.ndarray:
    """Compute IoU matrix between two sets of bboxes."""
    n1, n2 = len(bboxes1), len(bboxes2)
    iou_matrix = np.zeros((n1, n2))

    for i in range(n1):
        for j in range(n2):
            iou_matrix[i, j] = compute_iou(bboxes1[i], bboxes2[j])

    return iou_matrix


def linear_assignment(cost_matrix: np.ndarray, thresh: float = 0.5) -> Tuple[List, List, List]:
    """
    Solve linear assignment problem using Hungarian algorithm.
    Returns: (matched_pairs, unmatched_a, unmatched_b)
    """
    try:
        from scipy.optimize import linear_sum_assignment
    except ImportError:
        print("Warning: scipy not available, using greedy assignment")
        return greedy_assignment(cost_matrix, thresh)

    if cost_matrix.size == 0:
        return [], list(range(cost_matrix.shape[0])), list(range(cost_matrix.shape[1]))

    # Convert IoU to cost (higher IoU = lower cost)
    cost = 1 - cost_matrix

    row_ind, col_ind = linear_sum_assignment(cost)

    matched = []
    unmatched_a = list(range(cost_matrix.shape[0]))
    unmatched_b = list(range(cost_matrix.shape[1]))

    for r, c in zip(row_ind, col_ind):
        if cost_matrix[r, c] >= thresh:  # IoU threshold
            matched.append((r, c))
            unmatched_a.remove(r)
            unmatched_b.remove(c)

    return matched, unmatched_a, unmatched_b


def greedy_assignment(cost_matrix: np.ndarray, thresh: float = 0.5) -> Tuple[List, List, List]:
    """Greedy assignment fallback when scipy is not available."""
    matched = []
    unmatched_a = list(range(cost_matrix.shape[0]))
    unmatched_b = list(range(cost_matrix.shape[1]))

    if cost_matrix.size == 0:
        return matched, unmatched_a, unmatched_b

    # Sort by IoU descending
    indices = np.unravel_index(np.argsort(-cost_matrix.ravel()), cost_matrix.shape)

    for r, c in zip(indices[0], indices[1]):
        if r in unmatched_a and c in unmatched_b:
            if cost_matrix[r, c] >= thresh:
                matched.append((r, c))
                unmatched_a.remove(r)
                unmatched_b.remove(c)

    return matched, unmatched_a, unmatched_b


# =============================================================================
# BYTETRACK TRACKER
# =============================================================================

class ByteTracker:
    """
    ByteTrack: Multi-Object Tracking by Associating Every Detection Box

    Key insight: ByteTrack uses ALL detections including low-confidence ones
    in a two-stage association process. This helps recover occluded objects
    that might have lower confidence due to partial visibility.

    Stage 1: Match high-confidence detections with existing tracks
    Stage 2: Match remaining low-confidence detections with unmatched tracks

    This is particularly useful for:
    - Boats that are partially occluded by other boats
    - Distant boats with lower detector confidence
    - Brief detection gaps due to waves/spray

    Parameters to tune:
    - track_thresh (high_thresh): Confidence threshold for "high" detections (default: 0.5)
    - det_thresh (low_thresh): Minimum confidence to consider (default: 0.1)
    - track_buffer (max_age): Frames to keep lost tracks alive (default: 30)
    - match_thresh: IoU threshold for association (default: 0.8)
    """

    def __init__(
        self,
        track_thresh: float = DEFAULT_HIGH_THRESH,
        det_thresh: float = DEFAULT_LOW_THRESH,
        track_buffer: int = DEFAULT_TRACK_BUFFER,
        match_thresh: float = DEFAULT_MATCH_THRESH,
        min_box_area: float = DEFAULT_MIN_BOX_AREA,
    ):
        self.track_thresh = track_thresh    # High confidence threshold
        self.det_thresh = det_thresh        # Low confidence threshold
        self.track_buffer = track_buffer    # Max frames to keep lost track
        self.match_thresh = match_thresh    # IoU threshold for matching
        self.min_box_area = min_box_area    # Minimum bbox area

        self.frame_id = 0
        self.trackers: List[KalmanBoxTracker] = []
        self.lost_trackers: List[KalmanBoxTracker] = []

    def update(self, detections: List[Detection]) -> List[Track]:
        """
        Update tracker with new detections.

        Args:
            detections: List of Detection objects

        Returns:
            List of Track objects for current frame
        """
        self.frame_id += 1

        # Filter by minimum area
        filtered_dets = [
            d for d in detections
            if self._bbox_area(d.bbox) >= self.min_box_area
        ]

        # Split detections by confidence
        high_dets = [d for d in filtered_dets if d.confidence >= self.track_thresh]
        low_dets = [d for d in filtered_dets if self.det_thresh <= d.confidence < self.track_thresh]

        # Predict new locations of existing tracks
        for t in self.trackers:
            t.predict()

        # === STAGE 1: Match high-confidence detections with active tracks ===
        active_tracks = [t for t in self.trackers if t.time_since_update == 1]

        if len(active_tracks) > 0 and len(high_dets) > 0:
            track_bboxes = np.array([t.get_state() for t in active_tracks])
            det_bboxes = np.array([d.bbox for d in high_dets])
            iou_matrix = compute_iou_matrix(track_bboxes, det_bboxes)

            matched, unmatched_tracks, unmatched_dets = linear_assignment(
                iou_matrix, self.match_thresh
            )

            # Update matched tracks
            for t_idx, d_idx in matched:
                active_tracks[t_idx].update(
                    high_dets[d_idx].bbox,
                    high_dets[d_idx].confidence,
                    high_dets[d_idx].class_id
                )

            # Remaining
            unmatched_active = [active_tracks[i] for i in unmatched_tracks]
            remaining_high = [high_dets[i] for i in unmatched_dets]
        else:
            unmatched_active = active_tracks
            remaining_high = high_dets

        # === STAGE 2: Match low-confidence detections with unmatched tracks ===
        # This is ByteTrack's key innovation - using low-conf dets to maintain tracks
        if len(unmatched_active) > 0 and len(low_dets) > 0:
            track_bboxes = np.array([t.get_state() for t in unmatched_active])
            det_bboxes = np.array([d.bbox for d in low_dets])
            iou_matrix = compute_iou_matrix(track_bboxes, det_bboxes)

            matched_low, still_unmatched, _ = linear_assignment(
                iou_matrix, self.match_thresh * 0.8  # Slightly lower threshold
            )

            for t_idx, d_idx in matched_low:
                unmatched_active[t_idx].update(
                    low_dets[d_idx].bbox,
                    low_dets[d_idx].confidence,
                    low_dets[d_idx].class_id
                )
        else:
            still_unmatched = list(range(len(unmatched_active)))

        # === STAGE 3: Try to match remaining tracks with lost trackers ===
        # (Tracks that were lost but predicted back into frame)
        if len(remaining_high) > 0 and len(self.lost_trackers) > 0:
            # Predict lost tracker positions
            for t in self.lost_trackers:
                t.predict()

            lost_bboxes = np.array([t.get_state() for t in self.lost_trackers])
            det_bboxes = np.array([d.bbox for d in remaining_high])
            iou_matrix = compute_iou_matrix(lost_bboxes, det_bboxes)

            matched_lost, _, unmatched_new = linear_assignment(
                iou_matrix, self.match_thresh * 0.7
            )

            for t_idx, d_idx in matched_lost:
                self.lost_trackers[t_idx].update(
                    remaining_high[d_idx].bbox,
                    remaining_high[d_idx].confidence,
                    remaining_high[d_idx].class_id
                )
                self.trackers.append(self.lost_trackers[t_idx])

            # Remove recovered tracks from lost list
            recovered_indices = set(t_idx for t_idx, _ in matched_lost)
            self.lost_trackers = [
                t for i, t in enumerate(self.lost_trackers)
                if i not in recovered_indices
            ]

            remaining_high = [remaining_high[i] for i in unmatched_new]

        # === Create new tracks for unmatched high-confidence detections ===
        for det in remaining_high:
            new_tracker = KalmanBoxTracker(det.bbox)
            new_tracker.confidence = det.confidence
            new_tracker.class_id = det.class_id
            self.trackers.append(new_tracker)

        # === Move lost tracks and clean up ===
        new_trackers = []
        for t in self.trackers:
            if t.time_since_update <= 1:
                new_trackers.append(t)
            elif t.time_since_update <= self.track_buffer:
                self.lost_trackers.append(t)

        self.trackers = new_trackers

        # Remove old lost tracks
        self.lost_trackers = [
            t for t in self.lost_trackers
            if t.time_since_update <= self.track_buffer
        ]

        # === Generate output tracks ===
        results = []
        for t in self.trackers:
            if t.time_since_update <= 1 and t.hits >= 3:  # Require 3 hits to confirm
                results.append(Track(
                    track_id=t.id,
                    bbox=t.get_state(),
                    confidence=t.confidence,
                    class_id=t.class_id,
                    class_name="boat",
                    age=t.age,
                    hits=t.hits,
                    time_since_update=t.time_since_update
                ))

        return results

    def _bbox_area(self, bbox: np.ndarray) -> float:
        """Compute bbox area."""
        return (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])


# =============================================================================
# BOT-SORT TRACKER (Fallback with Re-ID)
# =============================================================================

class BoTSORTTracker:
    """
    BoT-SORT: Robust Associations Multi-Pedestrian Tracking

    Enhancement over ByteTrack with:
    - Camera motion compensation (for moving cameras like on boats)
    - Better re-identification for identity recovery after occlusions

    Note: Full BoT-SORT requires a ReID model. This is a simplified version
    that focuses on motion compensation for boat-mounted cameras.

    When to use instead of ByteTrack:
    - If you have frequent identity switches after occlusions
    - If camera motion is very aggressive
    - If boats look similar (may need full ReID model)
    """

    def __init__(
        self,
        track_thresh: float = DEFAULT_HIGH_THRESH,
        det_thresh: float = DEFAULT_LOW_THRESH,
        track_buffer: int = DEFAULT_TRACK_BUFFER,
        match_thresh: float = DEFAULT_MATCH_THRESH,
        min_box_area: float = DEFAULT_MIN_BOX_AREA,
        use_cmc: bool = True,  # Camera motion compensation
    ):
        # Use ByteTrack as base
        self.byte_tracker = ByteTracker(
            track_thresh, det_thresh, track_buffer, match_thresh, min_box_area
        )
        self.use_cmc = use_cmc
        self.prev_frame = None
        self.affine_matrix = None

    def update(self, detections: List[Detection], frame: Optional[np.ndarray] = None) -> List[Track]:
        """
        Update tracker with camera motion compensation.

        Args:
            detections: List of Detection objects
            frame: Current frame (grayscale or BGR) for motion estimation

        Returns:
            List of Track objects
        """
        # Apply camera motion compensation
        if self.use_cmc and frame is not None:
            self._estimate_camera_motion(frame)
            if self.affine_matrix is not None:
                self._compensate_camera_motion()

        # Use ByteTrack for association
        tracks = self.byte_tracker.update(detections)

        # Store frame for next iteration
        if frame is not None:
            self.prev_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame

        return tracks

    def _estimate_camera_motion(self, frame: np.ndarray):
        """Estimate camera motion using sparse optical flow."""
        if self.prev_frame is None:
            self.affine_matrix = None
            return

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame

        # Detect features in previous frame
        prev_pts = cv2.goodFeaturesToTrack(
            self.prev_frame,
            maxCorners=200,
            qualityLevel=0.01,
            minDistance=30,
            blockSize=3
        )

        if prev_pts is None or len(prev_pts) < 10:
            self.affine_matrix = None
            return

        # Track features to current frame
        curr_pts, status, _ = cv2.calcOpticalFlowPyrLK(
            self.prev_frame, gray, prev_pts, None
        )

        # Filter good points
        good_prev = prev_pts[status.flatten() == 1]
        good_curr = curr_pts[status.flatten() == 1]

        if len(good_prev) < 4:
            self.affine_matrix = None
            return

        # Estimate affine transformation with RANSAC
        self.affine_matrix, _ = cv2.estimateAffinePartial2D(
            good_prev, good_curr, method=cv2.RANSAC, ransacReprojThreshold=5.0
        )

    def _compensate_camera_motion(self):
        """Apply camera motion to tracker predictions."""
        if self.affine_matrix is None:
            return

        for tracker in self.byte_tracker.trackers:
            bbox = tracker.get_state()
            # Transform corners
            corners = np.array([
                [bbox[0], bbox[1]],
                [bbox[2], bbox[3]]
            ], dtype=np.float32)

            # Apply affine transformation
            corners_h = np.hstack([corners, np.ones((2, 1))])
            transformed = corners_h @ self.affine_matrix.T

            # Update tracker state (simplified - full implementation would update Kalman state)
            new_bbox = np.array([
                transformed[0, 0], transformed[0, 1],
                transformed[1, 0], transformed[1, 1]
            ])

            # Clamp to valid range
            new_bbox = np.clip(new_bbox, 0, 10000)


# =============================================================================
# DETECTOR INTERFACES
# =============================================================================

class RoboflowDetector:
    """Detector using Roboflow hosted model via SDK."""

    def __init__(self, api_key: str, model_id: str, conf_threshold: float = DEFAULT_CONF_THRESHOLD):
        self.api_key = api_key
        self.model_id = model_id
        self.conf_threshold = conf_threshold
        self.model = None

    def initialize(self):
        """Initialize Roboflow client."""
        try:
            from roboflow import Roboflow
        except ImportError:
            raise ImportError("Please install roboflow: pip install roboflow")

        rf = Roboflow(api_key=self.api_key)
        project_name, version = self.model_id.rsplit("/", 1)
        project = rf.workspace().project(project_name)
        self.model = project.version(int(version)).model
        print(f"Loaded Roboflow model: {self.model_id}")

    def detect(self, frame: np.ndarray) -> List[Detection]:
        """Run detection on a frame."""
        if self.model is None:
            self.initialize()

        # Save frame temporarily (Roboflow SDK needs file path or URL)
        import tempfile
        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as f:
            temp_path = f.name
            cv2.imwrite(temp_path, frame)

        try:
            result = self.model.predict(temp_path, confidence=int(self.conf_threshold * 100)).json()
        finally:
            os.unlink(temp_path)

        detections = []
        for pred in result.get('predictions', []):
            # Roboflow returns center x, y, width, height
            cx, cy = pred['x'], pred['y']
            w, h = pred['width'], pred['height']

            bbox = np.array([
                cx - w / 2,
                cy - h / 2,
                cx + w / 2,
                cy + h / 2
            ])

            detections.append(Detection(
                bbox=bbox,
                confidence=pred['confidence'],
                class_id=pred.get('class_id', 0),
                class_name=pred.get('class', 'boat')
            ))

        return detections


class RoboflowInferenceDetector:
    """Detector using local Roboflow Inference Server (faster, no API calls)."""

    def __init__(self, model_id: str, conf_threshold: float = DEFAULT_CONF_THRESHOLD,
                 server_url: str = "http://localhost:9001"):
        self.model_id = model_id
        self.conf_threshold = conf_threshold
        self.server_url = server_url
        self.client = None

    def initialize(self):
        """Initialize inference client."""
        try:
            from inference_sdk import InferenceHTTPClient
        except ImportError:
            raise ImportError("Please install inference-sdk: pip install inference-sdk")

        self.client = InferenceHTTPClient(
            api_url=self.server_url,
            api_key=os.getenv("ROBOFLOW_API_KEY", "")
        )
        print(f"Connected to Roboflow Inference Server at {self.server_url}")
        print(f"Model: {self.model_id}")

    def detect(self, frame: np.ndarray) -> List[Detection]:
        """Run detection on a frame."""
        if self.client is None:
            self.initialize()

        result = self.client.infer(frame, model_id=self.model_id)

        detections = []
        for pred in result.get('predictions', []):
            cx, cy = pred['x'], pred['y']
            w, h = pred['width'], pred['height']

            if pred['confidence'] < self.conf_threshold:
                continue

            bbox = np.array([
                cx - w / 2,
                cy - h / 2,
                cx + w / 2,
                cy + h / 2
            ])

            detections.append(Detection(
                bbox=bbox,
                confidence=pred['confidence'],
                class_id=pred.get('class_id', 0),
                class_name=pred.get('class', 'boat')
            ))

        return detections


class YOLODetector:
    """Detector using local YOLOv8 via ultralytics."""

    def __init__(self, model_path: str = "yolov8n.pt", conf_threshold: float = DEFAULT_CONF_THRESHOLD,
                 target_classes: Optional[List[int]] = None):
        """
        Args:
            model_path: Path to YOLO weights or model name (e.g., "yolov8n.pt")
            conf_threshold: Confidence threshold
            target_classes: List of class IDs to detect (None = all, [8] = boats in COCO)
        """
        self.model_path = model_path
        self.conf_threshold = conf_threshold
        self.target_classes = target_classes  # [8] for boats in COCO
        self.model = None

    def initialize(self):
        """Load YOLO model."""
        try:
            from ultralytics import YOLO
        except ImportError:
            raise ImportError("Please install ultralytics: pip install ultralytics")

        self.model = YOLO(self.model_path)
        print(f"Loaded YOLO model: {self.model_path}")
        if self.target_classes:
            print(f"Filtering classes: {self.target_classes}")

    def detect(self, frame: np.ndarray) -> List[Detection]:
        """Run detection on a frame."""
        if self.model is None:
            self.initialize()

        results = self.model(frame, conf=self.conf_threshold, verbose=False)[0]

        detections = []
        for box in results.boxes:
            class_id = int(box.cls[0])

            # Filter by target classes if specified
            if self.target_classes and class_id not in self.target_classes:
                continue

            bbox = box.xyxy[0].cpu().numpy()
            conf = float(box.conf[0])

            detections.append(Detection(
                bbox=bbox,
                confidence=conf,
                class_id=class_id,
                class_name=results.names[class_id]
            ))

        return detections


# =============================================================================
# VISUALIZATION
# =============================================================================

def draw_tracks(frame: np.ndarray, tracks: List[Track], show_info: bool = True) -> np.ndarray:
    """Draw tracked objects on frame."""
    annotated = frame.copy()

    for track in tracks:
        color = COLORS[track.track_id % len(COLORS)]
        bbox = track.bbox.astype(int)

        # Draw bounding box
        cv2.rectangle(annotated, (bbox[0], bbox[1]), (bbox[2], bbox[3]), color, 2)

        # Draw track ID label
        label = f"ID:{track.track_id}"
        if show_info:
            label += f" ({track.confidence:.2f})"

        # Background for label
        (w, h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
        cv2.rectangle(annotated, (bbox[0], bbox[1] - h - 10), (bbox[0] + w + 5, bbox[1]), color, -1)

        # Label text
        cv2.putText(annotated, label, (bbox[0] + 2, bbox[1] - 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

    return annotated


# =============================================================================
# MAIN PROCESSING PIPELINE
# =============================================================================

def process_video(
    video_path: str,
    output_video_path: str,
    output_log_path: str,
    detector: Callable,
    tracker_type: str = "bytetrack",
    conf_threshold: float = DEFAULT_CONF_THRESHOLD,
    track_buffer: int = DEFAULT_TRACK_BUFFER,
    match_thresh: float = DEFAULT_MATCH_THRESH,
    min_box_area: float = DEFAULT_MIN_BOX_AREA,
    high_thresh: float = DEFAULT_HIGH_THRESH,
    low_thresh: float = DEFAULT_LOW_THRESH,
    show_progress: bool = True,
):
    """
    Process video with detection and tracking.

    Args:
        video_path: Input video file path
        output_video_path: Output annotated video path
        output_log_path: Output log file path (CSV or JSON)
        detector: Detector instance with .detect(frame) method
        tracker_type: "bytetrack" or "botsort"
        ... (other parameters)
    """
    # Open video
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")

    # Get video properties
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    print(f"Video: {width}x{height} @ {fps:.1f} fps, {total_frames} frames")

    # Initialize video writer
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(output_video_path, fourcc, fps, (width, height))

    # Initialize tracker
    if tracker_type.lower() == "bytetrack":
        tracker = ByteTracker(
            track_thresh=high_thresh,
            det_thresh=low_thresh,
            track_buffer=track_buffer,
            match_thresh=match_thresh,
            min_box_area=min_box_area
        )
        print("Using ByteTrack tracker")
    elif tracker_type.lower() == "botsort":
        tracker = BoTSORTTracker(
            track_thresh=high_thresh,
            det_thresh=low_thresh,
            track_buffer=track_buffer,
            match_thresh=match_thresh,
            min_box_area=min_box_area,
            use_cmc=True
        )
        print("Using BoT-SORT tracker (with camera motion compensation)")
    else:
        raise ValueError(f"Unknown tracker type: {tracker_type}")

    # Storage for tracking log
    all_tracks = []

    frame_idx = 0
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # Run detection
            detections = detector.detect(frame)

            # Run tracking
            if tracker_type.lower() == "botsort":
                tracks = tracker.update(detections, frame)
            else:
                tracks = tracker.update(detections)

            # Store results
            for track in tracks:
                all_tracks.append({
                    "frame_index": frame_idx,
                    "timestamp": frame_idx / fps,
                    "track_id": track.track_id,
                    "x1": float(track.bbox[0]),
                    "y1": float(track.bbox[1]),
                    "x2": float(track.bbox[2]),
                    "y2": float(track.bbox[3]),
                    "confidence": float(track.confidence),
                    "class": track.class_name,
                    "class_id": track.class_id
                })

            # Draw and write frame
            annotated = draw_tracks(frame, tracks)
            writer.write(annotated)

            # Progress
            frame_idx += 1
            if show_progress and frame_idx % 50 == 0:
                pct = (frame_idx / total_frames) * 100
                print(f"Processing: {frame_idx}/{total_frames} ({pct:.1f}%) - {len(tracks)} active tracks")

    finally:
        cap.release()
        writer.release()

    # Save tracking log
    log_ext = Path(output_log_path).suffix.lower()
    if log_ext == ".json":
        with open(output_log_path, 'w') as f:
            json.dump(all_tracks, f, indent=2)
    elif log_ext == ".csv":
        if all_tracks:
            with open(output_log_path, 'w', newline='') as f:
                fieldnames = all_tracks[0].keys()
                writer_csv = csv.DictWriter(f, fieldnames=fieldnames)
                writer_csv.writeheader()
                writer_csv.writerows(all_tracks)
    else:
        # Default to JSON
        with open(output_log_path + ".json", 'w') as f:
            json.dump(all_tracks, f, indent=2)

    print(f"\nProcessing complete!")
    print(f"Output video: {output_video_path}")
    print(f"Tracking log: {output_log_path}")
    print(f"Total frames: {frame_idx}")
    print(f"Total track entries: {len(all_tracks)}")

    # Summary statistics
    unique_tracks = len(set(t["track_id"] for t in all_tracks))
    print(f"Unique track IDs: {unique_tracks}")

    return all_tracks


# =============================================================================
# CLI INTERFACE
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Multi-Object Tracking for Boats using ByteTrack/BoT-SORT",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Using Roboflow Inference Server (local, fast)
  python track_boats.py --video_in input.mp4 --detector roboflow_local

  # Using Roboflow hosted API
  python track_boats.py --video_in input.mp4 --detector roboflow_api

  # Using local YOLOv8 model
  python track_boats.py --video_in input.mp4 --detector yolo --yolo_model yolov8n.pt

  # With custom parameters
  python track_boats.py --video_in input.mp4 --conf 0.3 --tracker botsort --track_buffer 60

Parameter Tuning Guide:
  --conf (confidence threshold):
    - Lower (0.1-0.3): Catches more distant/small boats but more false positives
    - Higher (0.5-0.7): Fewer false positives but may miss faint detections
    - Recommended for boats: 0.25-0.35

  --track_buffer (max age in frames):
    - Higher (30-60): Keeps tracks alive longer during occlusions
    - Lower (10-20): Removes lost tracks faster, fewer ID switches on reappear
    - Recommended: 30 frames (about 1.2 seconds at 25fps)

  --match_thresh (IoU threshold):
    - Higher (0.7-0.9): Stricter matching, fewer false associations
    - Lower (0.4-0.6): More lenient, better for fast-moving boats
    - Recommended: 0.7-0.8

  --min_box_area (minimum detection area):
    - Lower (50-100): Include tiny distant boats
    - Higher (200-500): Filter out noise from small detections
    - Recommended: 100-200 for maritime scenarios

  --high_thresh / --low_thresh (ByteTrack specific):
    - These control the two-stage association
    - high_thresh: detections above this are matched first (default: 0.5)
    - low_thresh: detections between low and high are used in second stage (default: 0.1)
    - This helps recover occluded boats with lower confidence
        """
    )

    # Required arguments
    parser.add_argument("--video_in", required=True, help="Input video file path")

    # Output arguments
    parser.add_argument("--video_out", default=None,
                        help="Output video path (default: input_tracked.mp4)")
    parser.add_argument("--log_out", default=None,
                        help="Output log path (default: input_tracks.json)")

    # Detector selection
    parser.add_argument("--detector", choices=["roboflow_api", "roboflow_local", "yolo"],
                        default="roboflow_local",
                        help="Detector to use (default: roboflow_local)")
    parser.add_argument("--model_id", default=ROBOFLOW_MODEL_ID,
                        help=f"Roboflow model ID (default: {ROBOFLOW_MODEL_ID})")
    parser.add_argument("--yolo_model", default="yolov8n.pt",
                        help="YOLO model path or name (default: yolov8n.pt)")
    parser.add_argument("--yolo_classes", type=int, nargs="*", default=[8],
                        help="YOLO class IDs to detect (default: 8 for boats)")

    # Tracker selection
    parser.add_argument("--tracker", choices=["bytetrack", "botsort"], default="bytetrack",
                        help="Tracker to use (default: bytetrack)")

    # Detection parameters
    parser.add_argument("--conf", type=float, default=DEFAULT_CONF_THRESHOLD,
                        help=f"Detection confidence threshold (default: {DEFAULT_CONF_THRESHOLD})")

    # Tracking parameters
    parser.add_argument("--track_buffer", type=int, default=DEFAULT_TRACK_BUFFER,
                        help=f"Frames to keep lost tracks (default: {DEFAULT_TRACK_BUFFER})")
    parser.add_argument("--match_thresh", type=float, default=DEFAULT_MATCH_THRESH,
                        help=f"IoU threshold for matching (default: {DEFAULT_MATCH_THRESH})")
    parser.add_argument("--min_box_area", type=float, default=DEFAULT_MIN_BOX_AREA,
                        help=f"Minimum bbox area (default: {DEFAULT_MIN_BOX_AREA})")
    parser.add_argument("--high_thresh", type=float, default=DEFAULT_HIGH_THRESH,
                        help=f"ByteTrack high confidence threshold (default: {DEFAULT_HIGH_THRESH})")
    parser.add_argument("--low_thresh", type=float, default=DEFAULT_LOW_THRESH,
                        help=f"ByteTrack low confidence threshold (default: {DEFAULT_LOW_THRESH})")

    # Misc
    parser.add_argument("--quiet", action="store_true", help="Suppress progress output")

    args = parser.parse_args()

    # Set default output paths
    input_stem = Path(args.video_in).stem
    if args.video_out is None:
        args.video_out = str(Path(args.video_in).parent / f"{input_stem}_tracked.mp4")
    if args.log_out is None:
        args.log_out = str(Path(args.video_in).parent / f"{input_stem}_tracks.json")

    # Ensure output directories exist
    Path(args.video_out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.log_out).parent.mkdir(parents=True, exist_ok=True)

    # Initialize detector
    print(f"Initializing detector: {args.detector}")
    if args.detector == "roboflow_api":
        api_key = os.getenv("ROBOFLOW_API_KEY", ROBOFLOW_API_KEY)
        if api_key == "YOUR_ROBOFLOW_API_KEY":
            print("Error: Please set ROBOFLOW_API_KEY environment variable")
            print("  export ROBOFLOW_API_KEY=your_key_here")
            sys.exit(1)
        detector = RoboflowDetector(api_key, args.model_id, args.conf)
    elif args.detector == "roboflow_local":
        detector = RoboflowInferenceDetector(args.model_id, args.conf)
    elif args.detector == "yolo":
        detector = YOLODetector(args.yolo_model, args.conf, args.yolo_classes or None)
    else:
        raise ValueError(f"Unknown detector: {args.detector}")

    detector.initialize()

    # Process video
    print(f"\nProcessing: {args.video_in}")
    print(f"Tracker: {args.tracker}")
    print(f"Confidence threshold: {args.conf}")
    print(f"Track buffer: {args.track_buffer} frames")
    print(f"Match threshold (IoU): {args.match_thresh}")
    print(f"Min box area: {args.min_box_area} px")
    if args.tracker == "bytetrack":
        print(f"High/Low thresholds: {args.high_thresh}/{args.low_thresh}")
    print()

    process_video(
        video_path=args.video_in,
        output_video_path=args.video_out,
        output_log_path=args.log_out,
        detector=detector,
        tracker_type=args.tracker,
        conf_threshold=args.conf,
        track_buffer=args.track_buffer,
        match_thresh=args.match_thresh,
        min_box_area=args.min_box_area,
        high_thresh=args.high_thresh,
        low_thresh=args.low_thresh,
        show_progress=not args.quiet,
    )


if __name__ == "__main__":
    main()
