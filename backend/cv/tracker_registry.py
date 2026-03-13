"""Per-stream ByteTrack tracker registry for batched multi-stream inference."""
from __future__ import annotations

import logging
import threading

from ultralytics.trackers.byte_tracker import BYTETracker

from common.types import Detection
from cv.config import (
    FUSE_SCORE,
    MATCH_THRESH,
    NEW_TRACK_THRESH,
    TRACK_BUFFER,
    TRACK_HIGH_THRESH,
    TRACK_LOW_THRESH,
)

logger = logging.getLogger(__name__)

_DEFAULT_FRAME_RATE = 30


class _TrackerArgs:
    """Namespace matching what BYTETracker expects from its args parameter."""

    track_high_thresh = TRACK_HIGH_THRESH
    track_low_thresh = TRACK_LOW_THRESH
    new_track_thresh = NEW_TRACK_THRESH
    track_buffer = TRACK_BUFFER
    match_thresh = MATCH_THRESH
    fuse_score = FUSE_SCORE


class TrackerRegistry:
    """Manages one BYTETracker instance per stream.

    Thread-safe for create/remove. The update() call itself is not locked
    because only the single inference thread calls it.
    """

    def __init__(
        self,
        class_name_map: dict[str, str],
        boat_classes: set[int],
        filter_boats: bool = True,
    ) -> None:
        self._lock = threading.Lock()
        self._trackers: dict[str, BYTETracker] = {}
        self._class_name_map = class_name_map
        self._boat_classes = boat_classes
        self._filter_boats = filter_boats

    def _create_tracker(self) -> BYTETracker:
        return BYTETracker(_TrackerArgs(), frame_rate=_DEFAULT_FRAME_RATE)

    def update(self, stream_id: str, results: object) -> list[Detection]:
        """Run ByteTrack on a single ultralytics Results object for a stream.

        Args:
            stream_id: Stream identifier for tracker isolation.
            results: A single ultralytics Results object (from model.predict()).

        Returns:
            Tracked detections with persistent track IDs assigned.
        """
        with self._lock:
            if stream_id not in self._trackers:
                self._trackers[stream_id] = self._create_tracker()
            tracker = self._trackers[stream_id]

        boxes = results.boxes
        names = results.names

        if boxes is None or len(boxes) == 0:
            # Advance tracker frame counter so lost tracks age out.
            # BYTETracker.update accesses results.conf etc., so we
            # increment frame_id directly when there are no detections.
            tracker.frame_id += 1
            return []

        # BYTETracker.update() expects an object with .conf, .xyxy, .xywh, .cls
        # and supports indexing — ultralytics Boxes satisfies this interface
        tracked = tracker.update(boxes, None)
        # tracked: np.ndarray shape (N, 8): [x1, y1, x2, y2, track_id, score, cls, idx]
        if len(tracked) == 0:
            return []

        detections: list[Detection] = []
        for row in tracked:
            x1, y1, x2, y2 = float(row[0]), float(row[1]), float(row[2]), float(row[3])
            track_id = int(row[4])
            score = float(row[5])
            class_id = int(row[6])

            if self._filter_boats and class_id not in self._boat_classes:
                continue

            w = x2 - x1
            h = y2 - y1
            raw_name = names.get(class_id, "boat")
            class_name = self._class_name_map.get(raw_name, raw_name)

            detections.append(
                Detection(
                    x=x1 + w / 2,
                    y=y1 + h / 2,
                    width=w,
                    height=h,
                    confidence=score,
                    class_id=class_id,
                    class_name=class_name,
                    track_id=track_id,
                )
            )

        return detections

    def reset(self, stream_id: str) -> None:
        with self._lock:
            self._trackers.pop(stream_id, None)

    def remove(self, stream_id: str) -> None:
        with self._lock:
            self._trackers.pop(stream_id, None)
