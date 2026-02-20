// API configuration
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Automatically derive WebSocket URL from API URL
// https:// -> wss://, http:// -> ws://
const WS_BASE_URL = import.meta.env.VITE_WS_URL || BASE_URL.replace(/^http/, "ws");

export const API_CONFIG = {
  BASE_URL,
  WS_BASE_URL,
} as const;

const MEDIAMTX_WHEP_BASE = import.meta.env.VITE_MEDIAMTX_WHEP_BASE || "http://localhost:8889";
const MEDIAMTX_HLS_BASE = import.meta.env.VITE_MEDIAMTX_HLS_BASE || "http://localhost:8888";

const normalizeBase = (value: string): string => value.replace(/\/$/, "");

export const VIDEO_CONFIG = {
  MEDIAMTX_WHEP_URL: (streamId: string, baseUrl?: string) =>
    `${normalizeBase(baseUrl || MEDIAMTX_WHEP_BASE)}/${streamId}/whep`,
  MEDIAMTX_HLS_URL: (streamId: string, baseUrl?: string) =>
    `${normalizeBase(baseUrl || MEDIAMTX_HLS_BASE)}/${streamId}/index.m3u8`,
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
  WS_URL: (streamId: string) => `${API_CONFIG.WS_BASE_URL}/api/detections/ws/${streamId}`,
  FILE_URL: `${API_CONFIG.BASE_URL}/api/detections/file`,
  POLL_INTERVAL: 1000, // ms (1 FPS - adjust as needed for real-time detection)
} as const;

// POI overlay configuration
export const POI_CONFIG = {
  HEIGHT: 150,
} as const;
