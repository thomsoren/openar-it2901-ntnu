"""
Pydantic models for API request/response validation.

Simplified architecture for real-time boat detection with AIS integration.
"""
from pydantic import BaseModel


class Detection(BaseModel):
    """
    Bounding box from YOLO detection.
    Represents where a boat is on screen.
    """
    x: float           # Center X coordinate (pixels)
    y: float           # Center Y coordinate (pixels)
    width: float       # Bounding box width (pixels)
    height: float      # Bounding box height (pixels)
    confidence: float  # Detection confidence (0-1)
    track_id: int | None = None  # Persistent ID for tracking same boat across frames


class Vessel(BaseModel):
    """
    AIS data for a vessel.
    Fetched from AIS API based on vessel position/MMSI.
    """
    mmsi: str                      # Maritime Mobile Service Identity (unique vessel ID)
    name: str | None = None        # Vessel name
    call_sign: str | None = None   # Radio call sign
    ship_type: str | None = None   # Type of vessel (cargo, tanker, passenger, etc.)
    destination: str | None = None # Reported destination
    speed: float | None = None     # Speed over ground (knots)
    heading: float | None = None   # Heading (degrees)
    latitude: float | None = None  # Current latitude
    longitude: float | None = None # Current longitude


class DetectedVessel(BaseModel):
    """
    A detected boat with optional AIS data.
    This is what the frontend receives and renders.
    """
    detection: Detection           # Screen coordinates from YOLO
    vessel: Vessel | None = None   # AIS data if matched, None otherwise
