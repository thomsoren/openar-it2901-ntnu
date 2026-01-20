"""
Streaming boat detection using Roboflow Inference.
Emits per-frame detections without writing any files.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, Any

from dotenv import load_dotenv
from inference import get_model

# Configuration
MODEL_ID = "boat-detection-model/1"

# Boat class names from Roboflow model
BOAT_CLASSES = {
    0: "Bulk carrier",
    1: "Container ship",
    2: "Cruise ship",
    3: "Ferry boat",
    4: "Fishing boat",
    5: "Ore carrier",
    6: "Sail boat",
    7: "Small boat",
    8: "Uncategorized",
}


@dataclass
class StreamConfig:
    confidence: float = 0.3
    iou_threshold: float = 0.5


from streaming.frame_source import FrameSource, FramePacket


class BoatDetectionStreamer:
    """
    Runs the detector and streams detection frames via callbacks.
    """

    def __init__(
        self,
        config: StreamConfig,
        frame_source: FrameSource,
        on_frame: Callable[[Dict[str, Any]], None],
        on_error: Callable[[str], None],
    ) -> None:
        self.config = config
        self.frame_source = frame_source
        self.on_frame = on_frame
        self.on_error = on_error
        self.model = None

    def _format_detections(self, packet: FramePacket, predictions) -> Dict[str, Any]:
        # Map inference results to the frontend's detection payload.
        frame_detections = {
            "frame": packet.frame_index,
            "timestamp": packet.timestamp,
            "detections": [],
        }

        for pred in predictions:
            class_id = getattr(pred, "class_id", None)
            class_name = getattr(pred, "class_name", None) or BOAT_CLASSES.get(int(class_id), "Unknown")

            frame_detections["detections"].append({
                "x": float(pred.x),
                "y": float(pred.y),
                "width": float(pred.width),
                "height": float(pred.height),
                "confidence": float(pred.confidence),
                "class": class_name,
                "class_id": int(class_id) if class_id is not None else -1,
            })

        return frame_detections

    def run(self) -> None:
        env_path = Path(__file__).resolve().parents[1] / ".env"
        load_dotenv(env_path)

        api_key = os.getenv("ROBOFLOW_API_KEY")
        if not api_key:
            self.on_error("ROBOFLOW_API_KEY not set in environment.")
            return

        try:
            self.model = get_model(MODEL_ID)
        except KeyboardInterrupt:
            self.on_error("Detection interrupted by user.")
            return
        except Exception as exc:
            self.on_error(f"Error during detection startup: {exc}")
            return

        # Consume frames from the shared source so video and detections stay in lockstep.
        frame_queue = self.frame_source.subscribe_thread()
        while True:
            try:
                packet = frame_queue.get()
                if packet is None:
                    break

                result = self.model.infer(
                    packet.frame,
                    confidence=self.config.confidence,
                    iou_threshold=self.config.iou_threshold,
                )[0]

                predictions = result.predictions if hasattr(result, "predictions") else []
                frame_detections = self._format_detections(packet, predictions)
                self.on_frame(frame_detections)
            except Exception as exc:
                self.on_error(f"Error during detection: {exc}")
