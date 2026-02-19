"""Backend duplicate-tag filter (dedup only, no motion smoothing)."""
from __future__ import annotations

from typing import Dict, List, Tuple

from common.types import Detection
from cv import config


class DetectionSmoother:
    """Coalesce duplicate tags so one boat maps to one track id."""

    def __init__(self):
        self._aliases: Dict[int, int] = {}
        self._recent: Dict[int, Tuple[float, float, float, float, float]] = {}
        self._next_virtual_id = -1

    def _canonical_id(self, track_id: int) -> int:
        parent = self._aliases.get(track_id)
        if parent is None:
            return track_id
        root = self._canonical_id(parent)
        self._aliases[track_id] = root
        return root

    @staticmethod
    def _to_xyxy(det: Detection) -> tuple[float, float, float, float]:
        half_w = det.width / 2.0
        half_h = det.height / 2.0
        return det.x - half_w, det.y - half_h, det.x + half_w, det.y + half_h

    @classmethod
    def _iou(cls, a: Detection, b: Detection) -> float:
        ax1, ay1, ax2, ay2 = cls._to_xyxy(a)
        bx1, by1, bx2, by2 = cls._to_xyxy(b)
        inter_x1 = max(ax1, bx1)
        inter_y1 = max(ay1, by1)
        inter_x2 = min(ax2, bx2)
        inter_y2 = min(ay2, by2)
        inter_w = max(0.0, inter_x2 - inter_x1)
        inter_h = max(0.0, inter_y2 - inter_y1)
        inter_area = inter_w * inter_h
        a_area = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
        b_area = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
        union = a_area + b_area - inter_area
        return inter_area / union if union > 0 else 0.0

    @staticmethod
    def _center_distance(a: Detection, b: Detection) -> float:
        dx = a.x - b.x
        dy = a.y - b.y
        return (dx * dx + dy * dy) ** 0.5

    def _is_same_boat(self, a: Detection, b: Detection) -> bool:
        iou = self._iou(a, b)
        center_dist = self._center_distance(a, b)
        scaled_center = min(a.width, a.height, b.width, b.height) * config.DEDUP_DUPLICATE_CENTER_FACTOR
        center_gate = max(config.DEDUP_DUPLICATE_MIN_CENTER_PX, scaled_center)
        return iou >= config.DEDUP_DUPLICATE_IOU or center_dist <= center_gate

    def _remap_id(self, det: Detection, track_id: int) -> Detection:
        return Detection(
            x=det.x,
            y=det.y,
            width=det.width,
            height=det.height,
            confidence=det.confidence,
            class_id=det.class_id,
            class_name=det.class_name,
            track_id=track_id,
        )

    def _expire_recent(self, now: float) -> None:
        stale = [
            tid
            for tid, (_, _, _, _, seen) in self._recent.items()
            if (now - seen) > config.DEDUP_TRACK_MAX_AGE_SEC
        ]
        for tid in stale:
            self._recent.pop(tid, None)
            self._aliases.pop(tid, None)

    def _assign_missing_ids(self, detections: List[Detection]) -> List[Detection]:
        """Fill missing track_id using nearest recent track; otherwise assign virtual id."""
        out: List[Detection] = []
        claimed: set[int] = set()

        for det in detections:
            if det.track_id is not None:
                out.append(self._remap_id(det, self._canonical_id(det.track_id)))
                claimed.add(out[-1].track_id)
                continue

            best_id = None
            best_dist = float("inf")
            for tid, (x, y, w, h, _) in self._recent.items():
                tid = self._canonical_id(tid)
                if tid in claimed:
                    continue
                dx = det.x - x
                dy = det.y - y
                dist = (dx * dx + dy * dy) ** 0.5
                gate = max(config.DEDUP_MATCH_GATE_MIN_PX, min(det.width, det.height, w, h) * config.DEDUP_MATCH_GATE_FACTOR)
                if dist <= gate and dist < best_dist:
                    best_dist = dist
                    best_id = tid

            if best_id is None:
                best_id = self._next_virtual_id
                self._next_virtual_id -= 1

            claimed.add(best_id)
            out.append(self._remap_id(det, best_id))

        return out

    @staticmethod
    def _best_per_track(detections: List[Detection]) -> List[Detection]:
        best: Dict[int, Detection] = {}
        for det in detections:
            if det.track_id is None:
                continue
            prev = best.get(det.track_id)
            if prev is None or det.confidence > prev.confidence:
                best[det.track_id] = det
        return list(best.values())

    def update(self, raw_detections: List[Detection], now: float) -> List[Detection]:
        """Dedup flow: expire cache -> fill IDs -> one per ID -> merge same-boat duplicates."""
        self._expire_recent(now)
        detections = self._assign_missing_ids(raw_detections)
        detections = self._best_per_track(detections)

        # Greedy suppression by confidence; alias loser id to winner for future frames.
        kept: List[Detection] = []
        for det in sorted(detections, key=lambda d: d.confidence, reverse=True):
            duplicate_of = next((k for k in kept if self._is_same_boat(det, k)), None)
            if duplicate_of is not None:
                if det.track_id is not None and duplicate_of.track_id is not None:
                    self._aliases[self._canonical_id(det.track_id)] = self._canonical_id(duplicate_of.track_id)
                continue
            kept.append(det)

        # Refresh recent cache from final emitted detections only.
        for det in kept:
            if det.track_id is None:
                continue
            self._recent[det.track_id] = (det.x, det.y, det.width, det.height, now)

        return kept
