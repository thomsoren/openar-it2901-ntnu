import { useMemo } from "react";
import type { VideoPlayerState } from "../components/video-player/VideoPlayer";

interface UseDatavisionStatusOptions {
  activeTabId: string;
  wsUrl: string;
  vesselsCount: number;
  isConnected: boolean;
  detectionTimestampMs: number;
  lastMessageAtMs: number;
  controlError: string | null;
  videoState: VideoPlayerState;
}

/**
 * Hook for generating a single Datavision status line for the overlay.
 *
 * @param activeTabId - Currently active stream tab id
 * @param vesselsCount - Number of currently rendered vessels
 * @param isConnected - Detection websocket connection state
 * @param controlError - Control-plane error text to include
 * @param videoState - Current video transport status
 *
 * @example
 * ```tsx
 * const { infoLabel } = useDatavisionStatus({
 *   activeTabId,
 *   vesselsCount: vessels.length,
 *   isConnected,
 *   controlError,
 *   videoState,
 * });
 * ```
 */
export function useDatavisionStatus({
  activeTabId,
  wsUrl,
  vesselsCount,
  isConnected,
  detectionTimestampMs,
  lastMessageAtMs,
  controlError,
  videoState,
}: UseDatavisionStatusOptions) {
  return useMemo(() => {
    const connectionLabel = isConnected ? "Connected" : "Disconnected";
    const videoLabel = `${videoState.transport.toUpperCase()} ${videoState.status}`;
    const messageLabel = lastMessageAtMs ? new Date(lastMessageAtMs).toLocaleTimeString() : "n/a";
    const detectionLabel = detectionTimestampMs || "n/a";
    const videoErrorLabel = videoState.error ? ` | Video error: ${videoState.error}` : "";
    const controlLabel = controlError ? ` | Control: ${controlError}` : "";

    return {
      infoLabel: `${connectionLabel} | Stream: ${activeTabId} | ${videoLabel} | Vessels: ${vesselsCount} | Last msg: ${messageLabel} | Last detection ts: ${detectionLabel} | WS: ${wsUrl}${videoErrorLabel}${controlLabel}`,
    };
  }, [
    activeTabId,
    wsUrl,
    vesselsCount,
    isConnected,
    detectionTimestampMs,
    lastMessageAtMs,
    controlError,
    videoState.transport,
    videoState.status,
    videoState.error,
  ]);
}
