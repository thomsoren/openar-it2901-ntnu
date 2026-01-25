"""
YOLO streaming detection service.

Processes video with YOLO and streams detection results.
Video playback is handled separately by the frontend.
"""
import time
from typing import Generator, Optional
from dataclasses import dataclass

import cv2
from ultralytics import YOLO

DEFAULT_MODEL_PATH = "yolov8s.pt"
DEFAULT_CONFIDENCE = 0.25
DEFAULT_FILTER_BOATS_ONLY = True


@dataclass
class DetectionResult:
    """Single detection from YOLO."""
    x: float  # Center X
    y: float  # Center Y
    width: float
    height: float
    confidence: float
    class_id: int
    class_name: str
    track_id: Optional[int] = None


@dataclass
class FrameDetections:
    """Detections for a video frame."""
    frame_index: int
    timestamp_ms: float
    detections: list[DetectionResult]
    fps: float


class YOLOVideoProcessor:
    """
    YOLO detection processor for video streams.

    Processes video frames and yields detection results.
    Does NOT encode/stream video - that's handled by frontend.
    """

    BOAT_CLASS_IDS = {8}  # 'boat' in COCO dataset

    def __init__(
        self,
        model_path: str = "yolov8s.pt",
        confidence_threshold: float = 0.25,
        filter_boats_only: bool = True,
        device: Optional[str] = None,
    ):
        self.model = YOLO(model_path)
        self.confidence_threshold = confidence_threshold
        self.filter_boats_only = filter_boats_only
        self.device = device
        self.class_names = self.model.names

    def process_video(
        self,
        source: str | int,
        track: bool = True,
        loop: bool = False,
    ) -> Generator[FrameDetections, None, None]:
        """
        Process video with YOLO and yield detections synced to real-time.

        Skips frames to stay synced with where the video would be playing,
        so detections match the current playback position even if YOLO
        can't process every frame.

        Args:
            source: Video file path, camera index, or RTSP URL
            track: If True, use object tracking for persistent IDs
            loop: If True, loop video when it ends

        Yields:
            FrameDetections for each processed frame
        """
        while True:
            cap = cv2.VideoCapture(source)
            if not cap.isOpened():
                raise RuntimeError(f"Failed to open video source: {source}")

            source_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            video_duration_ms = (total_frames / source_fps) * 1000
            print(f"Video: {source_fps:.1f} FPS, {total_frames} frames, {video_duration_ms/1000:.1f}s")

            predict_kwargs = {
                "conf": self.confidence_threshold,
                "verbose": False,
            }
            if self.device:
                predict_kwargs["device"] = self.device
            if self.filter_boats_only:
                predict_kwargs["classes"] = list(self.BOAT_CLASS_IDS)

            fps_window: list[float] = []
            playback_start = time.time()
            frames_processed = 0

            try:
                while True:
                    loop_start = time.time()

                    # Calculate where playback would be right now
                    elapsed_ms = (time.time() - playback_start) * 1000

                    # Handle looping
                    if loop and video_duration_ms > 0:
                        elapsed_ms = elapsed_ms % video_duration_ms

                    # Seek to the frame that matches current playback time
                    cap.set(cv2.CAP_PROP_POS_MSEC, elapsed_ms)

                    ret, frame = cap.read()
                    if not ret:
                        if loop:
                            # Reset to beginning
                            playback_start = time.time()
                            cap.set(cv2.CAP_PROP_POS_MSEC, 0)
                            self.model.predictor = None  # Reset tracker
                            continue
                        break

                    frame_index = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
                    timestamp_ms = cap.get(cv2.CAP_PROP_POS_MSEC)

                    # Run YOLO
                    if track:
                        results = self.model.track(frame, persist=True, **predict_kwargs)
                    else:
                        results = self.model.predict(frame, **predict_kwargs)

                    detections = self._parse_result(results[0])

                    # Calculate rolling FPS
                    frame_time = time.time() - loop_start
                    fps_window.append(frame_time)
                    if len(fps_window) > 30:
                        fps_window.pop(0)
                    avg_time = sum(fps_window) / len(fps_window)
                    actual_fps = 1.0 / avg_time if avg_time > 0 else 0

                    yield FrameDetections(
                        frame_index=frame_index,
                        timestamp_ms=timestamp_ms,
                        detections=detections,
                        fps=actual_fps,
                    )

                    frames_processed += 1

            finally:
                cap.release()
                if fps_window:
                    avg_fps = 1.0 / (sum(fps_window) / len(fps_window))
                    print(f"Processed {frames_processed} frames at {avg_fps:.1f} FPS")

            if not loop:
                break

    def _parse_result(self, result) -> list[DetectionResult]:
        """Parse YOLO result into DetectionResult objects."""
        detections = []

        if result.boxes is None:
            return detections

        boxes = result.boxes

        for i in range(len(boxes)):
            xyxy = boxes.xyxy[i].cpu().numpy()
            x1, y1, x2, y2 = xyxy

            width = x2 - x1
            height = y2 - y1
            x_center = x1 + width / 2
            y_center = y1 + height / 2

            confidence = float(boxes.conf[i].cpu().numpy())
            class_id = int(boxes.cls[i].cpu().numpy())
            class_name = self.class_names.get(class_id, "unknown")

            track_id = None
            if boxes.id is not None:
                track_id = int(boxes.id[i].cpu().numpy())

            detections.append(DetectionResult(
                x=float(x_center),
                y=float(y_center),
                width=float(width),
                height=float(height),
                confidence=confidence,
                class_id=class_id,
                class_name=class_name,
                track_id=track_id,
            ))

        return detections


# Global processor instance
_processor: Optional[YOLOVideoProcessor] = None


def get_processor() -> YOLOVideoProcessor:
    """Get or create the global YOLO video processor."""
    global _processor
    if _processor is None:
        import torch
        default_device = "cuda" if torch.cuda.is_available() else "cpu"
        device = default_device
        print(f"YOLO device: {device} (CUDA: {torch.cuda.is_available()})")

        _processor = YOLOVideoProcessor(
            model_path=DEFAULT_MODEL_PATH,
            confidence_threshold=DEFAULT_CONFIDENCE,
            filter_boats_only=DEFAULT_FILTER_BOATS_ONLY,
            device=device,
        )
    return _processor
