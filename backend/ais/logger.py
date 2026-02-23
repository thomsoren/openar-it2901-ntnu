"""
AIS Data Logger - Captures and buffers AIS messages during video processing.
Writes to NDJSON (newline-delimited JSON) format for efficient streaming.
"""
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pathlib import Path
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)


class AISLogEntry(BaseModel):
    """Pydantic model for a single AIS data point in the log."""

    timestamp: str
    mmsi: str
    latitude: float
    longitude: float
    speed: float
    heading: float
    course_over_ground: float = Field(..., alias="courseOverGround")
    name: str | None = None
    ship_type: int | None = Field(None, alias="shipType")
    navigational_status: int | None = Field(None, alias="navigationalStatus")
    rate_of_turn: float | None = Field(None, alias="rateOfTurn")
    log_received_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat(), alias="logReceivedAt")

    model_config = ConfigDict(populate_by_name=True)

    @classmethod
    def from_ais_data(cls, ais_data: Dict[str, Any]) -> "AISLogEntry":
        """Create from raw AIS API response."""
        return cls(
            timestamp=ais_data.get("timestamp", ""),
            mmsi=str(ais_data.get("mmsi", "")),
            latitude=float(ais_data.get("latitude", 0)),
            longitude=float(ais_data.get("longitude", 0)),
            speed=float(ais_data.get("speed", -1)),
            heading=float(ais_data.get("heading", -1)),
            course_over_ground=float(ais_data.get("courseOverGround", -1)),
            name=ais_data.get("name"),
            ship_type=ais_data.get("shipType"),
            navigational_status=ais_data.get("navigationalStatus"),
            rate_of_turn=ais_data.get("rateOfTurn")
        )


class AISSessionLogger:
    """
    Manages AIS data logging with buffering and NDJSON output.
    Buffers messages and flushes to file automatically.
    If buffer exceeds capacity, completes current log and starts a new one with same base ID.
    """

    def __init__(
        self,
        buffer_size: int = 10,  # Reduced for faster flushing during testing
        log_dir: Path = Path("data/ais_logs")
    ):
        # Base session ID (same for all splits)
        self.base_session_id = f"ais_session_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{str(uuid4())[:8]}"
        self.split_count = 0

        self.buffer_size = buffer_size
        self.buffer_max = buffer_size * 2  # Cap to trigger new log file
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)

        # Buffering
        self.buffer: List[AISLogEntry] = []
        self.total_logged = 0  # Cumulative across all splits
        self.mmsi_set = set()
        self.flush_error: Optional[str] = None  # Track persistent flush failures

        # Session metadata
        self.start_time = datetime.now(timezone.utc).isoformat()
        self.end_time: Optional[str] = None

        # Initialize first log file
        self._init_new_log_file()

    def _init_new_log_file(self) -> None:
        """Initialize a new log file with incremented split counter."""
        self.split_count += 1
        session_id = f"{self.base_session_id}_{self.split_count}"
        self.log_file = self.log_dir / f"{session_id}.ndjson"
        self.meta_file = self.log_dir / f"{session_id}.meta.json"

        # Write session start metadata as first line
        try:
            session_start_meta = {
                "type": "session_start",
                "base_session_id": self.base_session_id,
                "split_number": self.split_count,
                "start_time": datetime.now(timezone.utc).isoformat()
            }
            with open(self.log_file, "w") as f:
                json_line = json.dumps(session_start_meta)
                f.write(json_line + "\n")
            logger.info(f"Started new log file: {session_id}")
        except Exception as e:
            logger.error(f"Failed to initialize log file: {e}")

    def _finish_current_log(self) -> bool:
        """Finish current log file and start a new one."""
        success = self.flush()
        if success:
            self._init_new_log_file()
        return success


    def log(self, ais_data: Dict[str, Any]) -> None:
        """
        Log an AIS data point.
        Automatically flushes buffer if size reached.
        Creates a new log file if buffer exceeds capacity.
        """
        try:
            entry = AISLogEntry.from_ais_data(ais_data)
            self.buffer.append(entry)
            self.mmsi_set.add(entry.mmsi)
            self.total_logged += 1
            logger.debug(f"Buffered entry #{self.total_logged}: MMSI {entry.mmsi}. Buffer size: {len(self.buffer)}/{self.buffer_size}")
        except Exception as e:
            logger.error(f"Failed to log entry: {e}")
            self.flush_error = f"Failed to log entry: {e}"
            return

        # Check if buffer needs flushing
        if len(self.buffer) >= self.buffer_size:
            if not self.flush():
                # If flush fails and buffer is at cap, start new log file
                if len(self.buffer) > self.buffer_max:
                    logger.warning(f"Buffer full and flush failed. Starting new log file.")
                    self._finish_current_log()

    def flush(self) -> bool:
        """
        Write buffered messages to NDJSON file and clear buffer.

        Returns:
            bool: True if flush succeeded, False if it failed.
        """
        if not self.buffer:
            return True  # Nothing to flush is success

        try:
            # Append to file in NDJSON format
            with open(self.log_file, "a") as f:
                for entry in self.buffer:
                    json_line = json.dumps(entry.model_dump(by_alias=True))
                    f.write(json_line + "\n")

            logger.info(f"Flushed {len(self.buffer)} entries to {self.log_file}")
            self.buffer = []
            self.flush_error = None  # Clear error on successful flush
            return True
        except Exception as e:
            error_msg = f"Failed to flush: {e}"
            logger.error(error_msg)
            self.flush_error = error_msg  # Store error for metadata
            return False

    def end_session(self) -> Dict[str, Any]:
        """
        End the session: flush remaining data and write metadata.
        Returns metadata summary including flush status and all log files created.
        """
        logger.info(f"Ending session. Remaining buffered entries: {len(self.buffer)}")

        # Flush remaining buffer
        flush_success = self.flush()

        # Set end time
        self.end_time = datetime.now(timezone.utc).isoformat()

        # Find all log files for this session (all splits)
        log_files = sorted([
            str(f) for f in self.log_dir.glob(f"{self.base_session_id}_*.ndjson")
        ])

        logger.info(f"Found {len(log_files)} log files: {log_files}")

        # Calculate total file size across all splits
        total_file_size = sum(
            Path(f).stat().st_size if Path(f).exists() else 0
            for f in log_files
        )

        # Generate metadata
        metadata = {
            "type": "session_end",
            "base_session_id": self.base_session_id,
            "total_splits": self.split_count,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "total_records": self.total_logged,
            "unique_mmsi_count": len(self.mmsi_set),
            "mmsi_list": sorted(list(self.mmsi_set)),
            "log_files": log_files,
            "total_file_size_bytes": total_file_size,
            "flush_success": flush_success,
            "flush_error": self.flush_error
        }

        # Append metadata as final line in the NDJSON file
        try:
            with open(self.log_file, "a") as f:
                json_line = json.dumps(metadata)
                f.write(json_line + "\n")
            logger.info(f"Session ended. Created {self.split_count} log file(s). Total size: {total_file_size} bytes. Metadata appended to {self.log_file}")
        except Exception as e:
            logger.error(f"Failed to write session metadata: {e}")
            metadata["flush_error"] = f"Failed to write metadata: {e}"
            metadata["flush_success"] = False

        return metadata

    def get_log_lines(self) -> List[Dict[str, Any]]:
        """
        Read all logged entries from file.
        Returns list of parsed JSON objects.
        """
        if not self.log_file.exists():
            return []

        try:
            lines = []
            with open(self.log_file, "r") as f:
                for line in f:
                    if line.strip():
                        lines.append(json.loads(line))
            return lines
        except Exception as e:
            logger.error(f"Failed to read log file: {e}")
            return []

    def get_metadata(self) -> Optional[Dict[str, Any]]:
        """Read metadata from file"""
        if not self.meta_file.exists():
            return None

        try:
            with open(self.meta_file, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to read metadata: {e}")
            return None
