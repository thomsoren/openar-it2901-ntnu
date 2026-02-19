import { useEffect, useCallback, useMemo, useSyncExternalStore } from "react";
import { DETECTION_CONFIG } from "../config/video";
import { DetectedVessel } from "../types/detection";

interface WebSocketConfig {
  /** Video source - file path, camera index, or RTSP URL */
  source?: string;
  /** Enable object tracking (default: true) */
  track?: boolean;
  /** Loop video when it ends (default: true) */
  loop?: boolean;
}

interface UseDetectionsWebSocketOptions {
  /** WebSocket endpoint URL (ws:// or wss://) */
  url?: string;
  /** Detection stream identifier used with the default detections WS endpoint */
  streamId?: string;
  /** Configuration to send on connection */
  config?: WebSocketConfig;
  /** Whether to connect automatically (default: true) */
  enabled?: boolean;
  /** Reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnect delay in ms (default: 3000) */
  reconnectDelay?: number;
}

interface VideoInfo {
  /** Video width in pixels */
  width: number;
  /** Video height in pixels */
  height: number;
  /** Video native FPS */
  fps: number;
}

interface WebSocketState {
  vessels: DetectedVessel[];
  frameIndex: number;
  fps: number;
  timestampMs: number;
  videoInfo: VideoInfo | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  isComplete: boolean;
}

interface UseDetectionsWebSocketResult extends WebSocketState {
  /** Manually connect to WebSocket */
  connect: () => void;
  /** Manually disconnect from WebSocket */
  disconnect: () => void;
}

interface WebSocketStore {
  getState: () => WebSocketState;
  subscribe: (listener: () => void) => () => void;
  connect: () => void;
  disconnect: () => void;
  cleanup: () => void;
}

/**
 * Creates a WebSocket store for detection updates.
 */
function createWebSocketStore(
  url: string,
  config: WebSocketConfig | undefined,
  autoReconnect: boolean,
  reconnectDelay: number
): WebSocketStore {
  let state: WebSocketState = {
    vessels: [],
    frameIndex: 0,
    fps: 0,
    timestampMs: 0,
    videoInfo: null,
    isConnected: false,
    isLoading: true,
    error: null,
    isComplete: false,
  };

  const listeners = new Set<() => void>();
  let ws: WebSocket | null = null;
  let reconnectTimeout: number | null = null;

  const notify = () => listeners.forEach((l) => l());

  const setState = (partial: Partial<WebSocketState>) => {
    state = { ...state, ...partial };
    notify();
  };

  const cleanup = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  };

  const connect = () => {
    cleanup();
    setState({ isLoading: true, error: null, isComplete: false });

    try {
      ws = new WebSocket(url);

      ws.onopen = () => {
        setState({ isConnected: true, isLoading: false, error: null });
        const defaultConfig: WebSocketConfig = { track: true, loop: true };
        ws?.send(JSON.stringify(config ? { ...defaultConfig, ...config } : defaultConfig));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case "ready":
              console.log("Video stream ready:", data);
              if (data.width && data.height) {
                setState({
                  videoInfo: {
                    width: data.width,
                    height: data.height,
                    fps: data.fps || 25,
                  },
                });
              }
              break;

            case "detections":
              setState({
                frameIndex: data.frame_index,
                timestampMs: data.timestamp_ms,
                fps: data.fps,
                vessels: data.vessels || [],
              });
              break;

            case "complete":
              console.log("Video stream complete");
              setState({ isComplete: true });
              break;

            case "error":
              console.error("Stream error:", data.message);
              setState({ error: data.message });
              break;
          }
        } catch (parseError) {
          console.error("Failed to parse WebSocket message:", parseError);
        }
      };

      ws.onerror = (event) => {
        console.error("WebSocket error:", event);
        setState({ error: "WebSocket connection error", isLoading: false });
      };

      ws.onclose = (event) => {
        setState({ isConnected: false });
        ws = null;

        if (!event.wasClean && autoReconnect && !state.isComplete) {
          console.log(`WebSocket closed unexpectedly. Reconnecting in ${reconnectDelay}ms...`);
          reconnectTimeout = window.setTimeout(connect, reconnectDelay);
        }
      };
    } catch (err) {
      setState({
        error: err instanceof Error ? err.message : "Failed to connect",
        isLoading: false,
      });
    }
  };

  const disconnect = () => {
    cleanup();
    setState({ isConnected: false, isLoading: false });
  };

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    connect,
    disconnect,
    cleanup,
  };
}

/**
 * Hook for receiving YOLO detection updates via WebSocket.
 * The backend processes video with YOLO and streams detection data.
 * Video playback is handled separately by the frontend at native speed.
 *
 * @example
 * ```tsx
 * const { vessels, fps, isConnected } = useDetectionsWebSocket({
 *   streamId: "default",
 *   config: { track: true, loop: true },
 * });
 *
 * return <PoiOverlay vessels={vessels} />;
 * ```
 */
export const useDetectionsWebSocket = ({
  url,
  streamId = "default",
  config,
  enabled = true,
  autoReconnect = true,
  reconnectDelay = 3000,
}: UseDetectionsWebSocketOptions): UseDetectionsWebSocketResult => {
  const resolvedUrl = useMemo(() => url ?? DETECTION_CONFIG.WS_URL(streamId), [streamId, url]);

  // Create store once per target URL.
  const store = useMemo(
    () => createWebSocketStore(resolvedUrl, config, autoReconnect, reconnectDelay),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autoReconnect, reconnectDelay, resolvedUrl]
  );

  const state = useSyncExternalStore(store.subscribe, store.getState);

  // Connect/disconnect based on enabled
  useEffect(() => {
    if (enabled) {
      store.connect();
    }
    return () => store.cleanup();
  }, [enabled, store]);

  const connect = useCallback(() => store.connect(), [store]);
  const disconnect = useCallback(() => store.disconnect(), [store]);

  return {
    ...state,
    connect,
    disconnect,
  };
};
