"""AIS data matching for sensor fusion with pre-recorded video."""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from common.types import Detection, Vessel

logger = logging.getLogger(__name__)


class AISMatcher:
    """Matches detections with AIS data using timestamps and pixel projections."""

    def __init__(
        self,
        ais_log_path: str | None = None,
        video_epoch_utc: str | None = None,
        time_window_s: float = 10.0,
        include_unmatched: bool = False,
    ):
        self.ais_log_path = ais_log_path
        self.video_epoch_utc = video_epoch_utc
        self.time_window_s = time_window_s
        self.include_unmatched = include_unmatched

        self.ais_data: List[dict] = []
        self.video_epoch: datetime | None = None
        self.enabled = False

        if ais_log_path and video_epoch_utc:
            self._load()

    def _load(self) -> None:
        """Load AIS data from NDJSON file."""
        if not self.ais_log_path:
            logger.info("No AIS log path configured - sensor fusion disabled")
            return

        path = Path(self.ais_log_path)
        if not path.exists():
            logger.warning(f"AIS log not found: {path} - sensor fusion disabled")
            return

        try:
            # Parse video epoch timestamp
            self.video_epoch = datetime.fromisoformat(self.video_epoch_utc.replace("+00:00", "+00:00"))

            # Load NDJSON data
            with open(path, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                        if entry.get("type") == "session_start":
                            continue  # Skip metadata

                        # Parse AIS message timestamp
                        if "msgtime" in entry:
                            entry["_parsed_time"] = datetime.fromisoformat(
                                entry["msgtime"].replace("+00:00", "+00:00")
                            )
                            self.ais_data.append(entry)
                    except (json.JSONDecodeError, ValueError) as e:
                        logger.debug(f"Skipping invalid AIS entry: {e}")
                        continue

            logger.info(f"Loaded {len(self.ais_data)} AIS entries from {path}")
            self.enabled = len(self.ais_data) > 0

        except Exception as e:
            logger.error(f"Failed to load AIS data: {e}")
            self.enabled = False

    def match_detections(
        self,
        detections: List[Detection],
        frame_index: int,
        fps: float,
    ) -> List[dict]:
        """
        Match detections with AIS data based on timestamp and pixel proximity.

        Args:
            detections: List of Detection objects from RT-DETR
            frame_index: Current frame number
            fps: Video frames per second

        Returns:
            List of {"detection": Detection, "vessel": Vessel | None} dicts
        """
        if not self.enabled or not self.video_epoch:
            return [{"detection": d.model_dump(), "vessel": None} for d in detections]

        # Calculate video timestamp for this frame
        frame_time_offset = frame_index / fps
        frame_timestamp = self.video_epoch.timestamp() + frame_time_offset

        # Find AIS entries within time window
        candidates = []
        for entry in self.ais_data:
            ais_time = entry["_parsed_time"].timestamp()
            time_diff = abs(ais_time - frame_timestamp)

            if time_diff <= self.time_window_s:
                projection = entry.get("projection")
                if projection and "x_px" in projection and "y_px" in projection:
                    candidates.append({
                        "entry": entry,
                        "time_diff": time_diff,
                        "x_px": projection["x_px"],
                        "y_px": projection["y_px"],
                    })

        # Match each detection with nearest AIS candidate
        result = []
        matched_ais_indices = set()

        for detection in detections:
            best_match = None
            best_distance = float("inf")
            best_idx = None

            for idx, candidate in enumerate(candidates):
                if idx in matched_ais_indices:
                    continue

                # Calculate pixel distance between detection center and AIS projection
                dx = detection.x - candidate["x_px"]
                dy = detection.y - candidate["y_px"]
                pixel_distance = (dx * dx + dy * dy) ** 0.5

                # Simple threshold: match if within 100 pixels
                if pixel_distance < 100 and pixel_distance < best_distance:
                    best_distance = pixel_distance
                    best_match = candidate
                    best_idx = idx

            vessel = None
            if best_match:
                matched_ais_indices.add(best_idx)
                vessel = self._build_vessel(best_match["entry"])

            result.append({
                "detection": detection.model_dump(),
                "vessel": vessel.model_dump() if vessel else None,
            })

        return result

    def _build_vessel(self, ais_entry: dict) -> Vessel:
        """Build Vessel object from AIS NDJSON entry."""
        return Vessel(
            mmsi=str(ais_entry.get("mmsi", "")),
            name=ais_entry.get("name"),
            call_sign=None,  # Not in this dataset
            ship_type=self._ship_type_to_string(ais_entry.get("shipType")),
            destination=None,  # Not in this dataset
            speed=ais_entry.get("speedOverGround"),
            heading=ais_entry.get("trueHeading"),
            latitude=ais_entry.get("latitude"),
            longitude=ais_entry.get("longitude"),
        )

    @staticmethod
    def _ship_type_to_string(ship_type: int | None) -> str | None:
        """Convert AIS ship type code to readable string."""
        if ship_type is None:
            return None

        # Common AIS ship type codes
        ship_types = {
            30: "Fishing",
            31: "Towing",
            32: "Towing (large)",
            33: "Dredging",
            34: "Diving",
            35: "Military",
            36: "Sailing",
            37: "Pleasure craft",
            50: "Pilot vessel",
            51: "Search and rescue",
            52: "Tug",
            53: "Port tender",
            60: "Passenger",
            70: "Cargo",
            80: "Tanker",
            99: "Other",
        }
        return ship_types.get(ship_type, f"Type {ship_type}")


def create_matcher_from_env() -> AISMatcher:
    """Create AIS matcher from environment variables."""
    ais_log = os.getenv("AUTO_FUSION_AIS_LOG")
    video_epoch = os.getenv("AUTO_FUSION_VIDEO_EPOCH_UTC")
    time_window = float(os.getenv("AUTO_FUSION_TIME_WINDOW_S", "10.0"))
    include_unmatched = os.getenv("AUTO_FUSION_INCLUDE_UNMATCHED", "false").lower() == "true"

    return AISMatcher(
        ais_log_path=ais_log,
        video_epoch_utc=video_epoch,
        time_window_s=time_window,
        include_unmatched=include_unmatched,
    )
