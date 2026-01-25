// API configuration
export const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_URL || "http://localhost:8000",
  // WebSocket URL (ws:// for http, wss:// for https)
  WS_BASE_URL: import.meta.env.VITE_WS_URL || "ws://localhost:8000",
} as const;

// Video configuration
export const VIDEO_CONFIG = {
  WIDTH: 1920,
  HEIGHT: 1080,
  SOURCE: `${API_CONFIG.BASE_URL}/api/video`,
} as const;

export const FUSION_VIDEO_CONFIG = {
  WIDTH: 2560,
  HEIGHT: 1440,
  SOURCE: `${API_CONFIG.BASE_URL}/api/video/fusion`,
} as const;

// Detection API configuration
export const DETECTION_CONFIG = {
  URL: `${API_CONFIG.BASE_URL}/api/detections`,
  /** WebSocket URL for real-time streaming detections */
  WS_URL: `${API_CONFIG.WS_BASE_URL}/api/detections/ws`,
  FILE_URL: `${API_CONFIG.BASE_URL}/api/detections/file`,
  POLL_INTERVAL: 1000, // ms (1 FPS - adjust as needed for real-time detection)
} as const;

// POI overlay configuration
export const POI_CONFIG = {
  HEIGHT: 150,
} as const;
