/**
 * Bounding box from YOLO detection.
 * Represents where a boat is on screen.
 */
export interface Detection {
  x: number; // Center X coordinate (pixels)
  y: number; // Center Y coordinate (pixels)
  width: number; // Bounding box width (pixels)
  height: number; // Bounding box height (pixels)
  confidence: number; // Detection confidence (0-1)
  class_name?: string; // Detection class (e.g. "boat", "buoy", "flotsam", "mob")
  track_id?: number; // Persistent ID for tracking same boat across frames
}

/**
 * AIS data for a vessel.
 * Fetched from AIS API based on vessel position/MMSI.
 */
export interface Vessel {
  mmsi: string; // Maritime Mobile Service Identity (unique vessel ID)
  name?: string; // Vessel name
  call_sign?: string; // Radio call sign
  ship_type?: string; // Type of vessel (cargo, tanker, passenger, etc.)
  destination?: string; // Reported destination
  speed?: number; // Speed over ground (knots)
  heading?: number; // Heading (degrees)
  latitude?: number; // Current latitude
  longitude?: number; // Current longitude
}

/**
 * A detected boat with optional AIS data.
 * This is what the frontend receives and renders.
 */
export interface DetectedVessel {
  detection: Detection; // Screen coordinates from YOLO
  vessel?: Vessel; // AIS data if matched, undefined otherwise
  fusion?: {
    match_distance_px?: number | null;
    range_m?: number | null;
    rel_bearing_deg?: number | null;
  };
  displayDirectionDeg?: number; // Direction rendered by the POI icon (degrees, 0=up, clockwise)
}

export interface DetectionPerformance {
  source_fps: number;
  detection_fps: number;
  decoded_at_ms: number;
  inference_started_at_ms?: number;
  inference_completed_at_ms?: number;
  published_at_ms: number;
  decode_to_inference_start_ms?: number;
  inference_duration_ms?: number;
  publish_duration_ms?: number;
  total_detection_latency_ms: number;
}
