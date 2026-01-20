// API configuration
export const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_URL || "http://localhost:8000",
} as const;

// Video and detection configuration
export const VIDEO_CONFIG = {
  WIDTH: 1920,
  HEIGHT: 1080,
  // Use API endpoints for video and detections
  DETECTIONS_STREAM_URL: `${API_CONFIG.BASE_URL}/api/detections/stream`,
  MJPEG_SOURCE: `${API_CONFIG.BASE_URL}/api/video/mjpeg`,
} as const;

export const POI_CONFIG = {
  HEIGHT: 150,
} as const;
