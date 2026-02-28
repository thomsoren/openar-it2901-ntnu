import { useEffect, useCallback, useMemo, useSyncExternalStore } from "react";
import { DETECTION_CONFIG } from "../config/video";
import { DetectedVessel } from "../types/detection";

interface UseDetectionsWebSocketOptions {
  /** WebSocket endpoint URL (ws:// or wss://) */
  url?: string;
  /** Detection stream identifier used with the default detections WS endpoint */
  streamId?: string;
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
  detectionTimestampMs: number;
  lastMessageAtMs: number;
  detectionFrameSentAtMs: number;
  videoInfo: VideoInfo | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  isComplete: boolean;
}

interface UseDetectionsWebSocketResult extends WebSocketState {
  /** Effective websocket URL used by this hook */
  wsUrl: string;
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
  autoReconnect: boolean,
  reconnectDelay: number
): WebSocketStore {
  let state: WebSocketState = {
    vessels: [],
    frameIndex: 0,
    fps: 0,
    detectionTimestampMs: 0,
    lastMessageAtMs: 0,
    detectionFrameSentAtMs: 0,
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
    setState({
      vessels: [],
      frameIndex: 0,
      fps: 0,
      detectionTimestampMs: 0,
      lastMessageAtMs: 0,
      detectionFrameSentAtMs: 0,
      videoInfo: null,
      isConnected: false,
      isLoading: true,
      error: null,
      isComplete: false,
    });

    try {
      ws = new WebSocket(url);

      ws.onopen = () => {
        setState({ isConnected: true, isLoading: false, error: null });
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case "ready":
              if (data.width && data.height) {
                setState({
                  lastMessageAtMs: Date.now(),
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
                detectionTimestampMs: data.timestamp_ms || 0,
                lastMessageAtMs: Date.now(),
                detectionFrameSentAtMs: data.frame_sent_at_ms || 0,
                fps: data.fps,
                vessels: data.vessels || [],
              });
              break;
            case "complete":
              setState({ isComplete: true, lastMessageAtMs: Date.now() });
              break;

            case "error":
              setState({ error: data.message, lastMessageAtMs: Date.now() });
              break;
          }
        } catch {
          // Malformed message — skip
        }
      };

      ws.onerror = () => {
        setState({ error: "WebSocket connection error", isLoading: false });
      };

      ws.onclose = (event) => {
        setState({
          isConnected: false,
          isLoading: false,
          vessels: [],
          frameIndex: 0,
          detectionTimestampMs: 0,
          lastMessageAtMs: 0,
          detectionFrameSentAtMs: 0,
          fps: 0,
        });
        ws = null;

        if (!event.wasClean && autoReconnect && !state.isComplete) {
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
    setState({
      isConnected: false,
      isLoading: false,
      vessels: [],
      frameIndex: 0,
      detectionTimestampMs: 0,
      lastMessageAtMs: 0,
      detectionFrameSentAtMs: 0,
      fps: 0,
    });
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
 * @param url - Optional explicit websocket URL; overrides streamId-derived default
 * @param streamId - Detection stream identifier for default URL construction
 * @param enabled - Whether websocket should be connected
 * @param autoReconnect - Whether to reconnect after unclean closes
 * @param reconnectDelay - Delay in ms before reconnect attempts
 *
 * @example
 * ```tsx
 * const { vessels, fps, isConnected } = useDetectionsWebSocket({
 *   streamId: "default",
 * });
 *
 * return <PoiOverlay vessels={vessels} />;
 * ```
 */
export const useDetectionsWebSocket = ({
  url,
  streamId = "default",
  enabled = true,
  autoReconnect = true,
  reconnectDelay = 3000,
}: UseDetectionsWebSocketOptions): UseDetectionsWebSocketResult => {
  const wsUrl = useMemo(() => url ?? DETECTION_CONFIG.WS_URL(streamId), [url, streamId]);

  const store = useMemo(
    () => createWebSocketStore(wsUrl, autoReconnect, reconnectDelay),
    [wsUrl, autoReconnect, reconnectDelay]
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
    wsUrl,
    connect,
    disconnect,
  };
};
