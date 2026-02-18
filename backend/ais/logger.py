"""
AIS Data Logger - Captures and buffers AIS messages during video processing.
Writes to NDJSON (newline-delimited JSON) format for efficient streaming.
"""
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pathlib import Path
from uuid import uuid4


class AISLogEntry:
    """Represents a single AIS data point in the log"""
    
    def __init__(
        self,
        timestamp: str,
        mmsi: str,
        latitude: float,
        longitude: float,
        speed: float,
        heading: float,
        course_over_ground: float,
        name: Optional[str] = None,
        ship_type: Optional[str] = None,
        navigational_status: Optional[int] = None,
        frame_idx: Optional[int] = None,
        rate_of_turn: Optional[float] = None
    ):
        self.timestamp = timestamp
        self.mmsi = mmsi
        self.latitude = latitude
        self.longitude = longitude
        self.speed = speed
        self.heading = heading
        self.course_over_ground = course_over_ground
        self.name = name
        self.ship_type = ship_type
        self.navigational_status = navigational_status
        self.frame_idx = frame_idx
        self.rate_of_turn = rate_of_turn
        self.log_received_at = datetime.now(timezone.utc).isoformat()
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            "timestamp": self.timestamp,
            "mmsi": self.mmsi,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "speed": self.speed,
            "heading": self.heading,
            "courseOverGround": self.course_over_ground,
            "name": self.name,
            "shipType": self.ship_type,
            "navigationalStatus": self.navigational_status,
            "frameIdx": self.frame_idx,
            "rateOfTurn": self.rate_of_turn,
            "logReceivedAt": self.log_received_at
        }
    
    @classmethod
    def from_ais_data(cls, ais_data: Dict[str, Any], frame_idx: Optional[int] = None) -> "AISLogEntry":
        """Create from raw AIS API response"""
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
            frame_idx=frame_idx,
            rate_of_turn=ais_data.get("rateOfTurn")
        )


class AISSessionLogger:
    """
    Manages AIS data logging with buffering and NDJSON output.
    Buffers messages and flushes to file automatically.
    """
    
    def __init__(
        self,
        buffer_size: int = 1000,
        log_dir: Path = Path("data/ais_logs")
    ):
        self.session_id = f"ais_session_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{str(uuid4())[:8]}"
        self.buffer_size = buffer_size
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        
        # File paths
        self.log_file = self.log_dir / f"{self.session_id}.ndjson"
        self.meta_file = self.log_dir / f"{self.session_id}.meta.json"
        
        # Buffering
        self.buffer: List[AISLogEntry] = []
        self.total_logged = 0
        self.mmsi_set = set()
        
        # Session metadata
        self.start_time = datetime.now(timezone.utc).isoformat()
        self.end_time: Optional[str] = None
        
    
    def log(self, ais_data: Dict[str, Any], frame_idx: Optional[int] = None) -> None:
        """
        Log an AIS data point.
        Automatically flushes buffer if size reached.
        """
        entry = AISLogEntry.from_ais_data(ais_data, frame_idx)
        self.buffer.append(entry)
        self.mmsi_set.add(entry.mmsi)
        self.total_logged += 1
        
        if len(self.buffer) >= self.buffer_size:
            self.flush()
    
    def flush(self) -> None:
        """
        Write buffered messages to NDJSON file and clear buffer.
        """
        if not self.buffer:
            return
        
        try:
            # Append to file in NDJSON format
            with open(self.log_file, "a") as f:
                for entry in self.buffer:
                    json_line = json.dumps(entry.to_dict())
                    f.write(json_line + "\n")
            
            print(f"[AISLogger] Flushed {len(self.buffer)} entries to {self.log_file}")
            self.buffer = []
        except Exception as e:
            print(f"[AISLogger ERROR] Failed to flush: {e}")
    
    def end_session(self) -> Dict[str, Any]:
        """
        End the session: flush remaining data and write metadata.
        Returns metadata summary.
        """
        # Flush remaining buffer
        self.flush()
        
        # Set end time
        self.end_time = datetime.now(timezone.utc).isoformat()
        
        # Generate metadata
        metadata = {
            "session_id": self.session_id,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "total_records": self.total_logged,
            "unique_mmsi_count": len(self.mmsi_set),
            "mmsi_list": sorted(list(self.mmsi_set)),
            "log_file": str(self.log_file),
            "file_size_bytes": self.log_file.stat().st_size if self.log_file.exists() else 0
        }
        
        # Write metadata
        try:
            with open(self.meta_file, "w") as f:
                json.dump(metadata, f, indent=2)
            print(f"[AISLogger] Session ended. Metadata written to {self.meta_file}")
        except Exception as e:
            print(f"[AISLogger ERROR] Failed to write metadata: {e}")
        
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
            print(f"[AISLogger ERROR] Failed to read log file: {e}")
            return []
    
    def get_metadata(self) -> Optional[Dict[str, Any]]:
        """Read metadata from file"""
        if not self.meta_file.exists():
            return None
        
        try:
            with open(self.meta_file, "r") as f:
                return json.load(f)
        except Exception as e:
            print(f"[AISLogger ERROR] Failed to read metadata: {e}")
            return None
