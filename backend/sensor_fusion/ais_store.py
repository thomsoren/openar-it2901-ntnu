"""
AISStore — loads a pre-recorded AIS NDJSON session log and provides
nearest-time lookups per MMSI or as a full snapshot.

The NDJSON format (produced by AISSessionLogger) looks like:

    {"type": "session_start", ...}
    {"mmsi": "257030830", "latitude": ..., "logReceivedAt": "2026-...", "projection": {...}}
    ...
    {"type": "session_end", ...}

Records are indexed by `logReceivedAt` (UTC ISO-8601). At query time you
supply a UTC datetime and get back all unique-MMSI records whose
`logReceivedAt` is within `time_window_s` seconds of that instant.

When a MMSI appears multiple times in the window, the one closest to the
query time is used.
"""
from __future__ import annotations

import json
import logging
from bisect import bisect_left, bisect_right
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class AISStore:
    """In-memory index of pre-recorded AIS track points from an NDJSON log."""

    def __init__(self, ndjson_path: str | Path, time_window_s: float = 10.0):
        """
        Args:
            ndjson_path: Path to the NDJSON session log file.
            time_window_s: How many seconds either side of the query time
                           to consider a record a candidate.
        """
        self.path = Path(ndjson_path)
        self.time_window_s = time_window_s

        # Sorted list of (unix_ts, record_dict) tuples — built at load time.
        self._records: list[tuple[float, dict[str, Any]]] = []
        self._sorted_ts: list[float] = []

        self._load()

    def _load(self) -> None:
        """Parse the NDJSON file and build the time index."""
        if not self.path.exists():
            raise FileNotFoundError(f"AIS log not found: {self.path}")

        records: list[tuple[float, dict[str, Any]]] = []
        skipped = 0

        with open(self.path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    skipped += 1
                    continue

                # Skip session metadata lines
                if obj.get("type") in {"session_start", "session_end"}:
                    continue

                raw_ts = obj.get("logReceivedAt") or obj.get("msgtime") or obj.get("timestamp")
                if not raw_ts:
                    skipped += 1
                    continue

                try:
                    dt = datetime.fromisoformat(raw_ts)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    ts = dt.timestamp()
                except ValueError:
                    skipped += 1
                    continue

                records.append((ts, obj))

        # Sort by timestamp ascending
        records.sort(key=lambda r: r[0])
        self._records = records
        self._sorted_ts = [r[0] for r in records]

        logger.info(
            "[AISStore] Loaded %d records from %s (skipped %d)",
            len(records), self.path.name, skipped,
        )

    def get_snapshot(self, query_utc: datetime) -> list[dict[str, Any]]:
        """
        Return the best AIS record per MMSI within `time_window_s` of `query_utc`.

        When multiple records for the same MMSI fall in the window, the one
        with the smallest absolute time difference is returned.

        Args:
            query_utc: The target UTC datetime (e.g. video_epoch + frame offset).

        Returns:
            List of AIS record dicts (one per unique MMSI).
        """
        if query_utc.tzinfo is None:
            query_utc = query_utc.replace(tzinfo=timezone.utc)

        q_ts = query_utc.timestamp()
        lo = bisect_left(self._sorted_ts, q_ts - self.time_window_s)
        hi = bisect_right(self._sorted_ts, q_ts + self.time_window_s)

        candidates = self._records[lo:hi]
        if not candidates:
            return []

        # Keep the closest record per MMSI
        best: dict[str, tuple[float, dict[str, Any]]] = {}
        for ts, record in candidates:
            mmsi = str(record.get("mmsi", ""))
            if not mmsi:
                continue
            diff = abs(ts - q_ts)
            if mmsi not in best or diff < best[mmsi][0]:
                best[mmsi] = (diff, record)

        return [rec for _, rec in best.values()]

    @property
    def record_count(self) -> int:
        return len(self._records)

    @property
    def time_range(self) -> tuple[datetime, datetime] | None:
        if not self._records:
            return None
        lo = datetime.fromtimestamp(self._sorted_ts[0], tz=timezone.utc)
        hi = datetime.fromtimestamp(self._sorted_ts[-1], tz=timezone.utc)
        return lo, hi
