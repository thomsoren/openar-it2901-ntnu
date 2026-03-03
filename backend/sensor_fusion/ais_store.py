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

import bisect
import json
import logging
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

                if obj.get("type") in {"session_start", "session_end"}:
                    continue

                raw_ts = obj.get("msgtime") or obj.get("logReceivedAt") or obj.get("timestamp")
                if not raw_ts:
                    skipped += 1
                    continue

                try:
                    dt = datetime.fromisoformat(raw_ts)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    records.append((dt.timestamp(), obj))
                except ValueError:
                    skipped += 1
                    continue

        records.sort(key=lambda r: r[0])
        self._records = records
        self._sorted_ts = [r[0] for r in records]
        logger.info(
            "[AISStore] Loaded %d records from %s (skipped %d)",
            len(records), self.path.name, skipped,
        )


    def get_snapshot(self, query_utc: datetime) -> list[dict[str, Any]]:
        """
        Return the best AIS record per MMSI from the entire log.

        Per MMSI, the latest record with ts <= query time is preferred
        (floor/lookback). If no record exists yet (vessel first appears
        after the query time), the earliest future record is used instead.

        Args:
            query_utc: The target UTC datetime (e.g. video_epoch + frame offset).

        Returns:
            List of AIS record dicts (one per unique MMSI).
        """
        if query_utc.tzinfo is None:
            query_utc = query_utc.replace(tzinfo=timezone.utc)

        q_ts = query_utc.timestamp()

        if not self._records:
            return []

        # Use bisect to narrow the scan to [q_ts - window, q_ts + window].
        # This implements the time_window_s contract and avoids O(n) full scans.
        lo_idx = bisect.bisect_left(self._sorted_ts, q_ts - self.time_window_s)
        hi_idx = bisect.bisect_right(self._sorted_ts, q_ts + self.time_window_s)

        # For each MMSI: track best past record (latest ts <= q_ts)
        # and best future record (earliest ts > q_ts) as fallback
        past: dict[str, tuple[float, dict[str, Any]]] = {}   # mmsi -> (ts, record)
        future: dict[str, tuple[float, dict[str, Any]]] = {}  # mmsi -> (ts, record)

        for ts, record in self._records[lo_idx:hi_idx]:
            mmsi = str(record.get("mmsi", ""))
            if not mmsi:
                continue
            if ts <= q_ts:
                if mmsi not in past or ts > past[mmsi][0]:
                    past[mmsi] = (ts, record)
            else:
                if mmsi not in future or ts < future[mmsi][0]:
                    future[mmsi] = (ts, record)

        result: dict[str, dict[str, Any]] = {}
        for mmsi, (_, rec) in past.items():
            result[mmsi] = rec
        for mmsi, (_, rec) in future.items():
            if mmsi not in result:
                result[mmsi] = rec

        return list(result.values())

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
