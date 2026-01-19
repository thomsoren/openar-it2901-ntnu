// API configuration
export const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_URL || "http://localhost:8000",
} as const;

// Video and detection configuration
export const VIDEO_CONFIG = {
  WIDTH: 1920,
  HEIGHT: 1080,
  // Use API endpoints for video and detections
  SOURCE: `${API_CONFIG.BASE_URL}/api/video/stream`,
  DETECTIONS_URL: `${API_CONFIG.BASE_URL}/api/detections`,
  // Fallback to local files if API is not available
  LOCAL_SOURCE: "/Hurtigruten-Front-Camera-Risoyhamn-Harstad-Dec-28-2011-3min-no-audio.mp4",
  LOCAL_DETECTIONS_URL: "/detections.json",
} as const;

export const POI_CONFIG = {
  HEIGHT: 150,
} as const;
