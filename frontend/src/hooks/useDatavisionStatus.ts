import { useMemo } from "react";
import type { VideoPlayerState } from "../components/video-player/VideoPlayer";

interface UseDatavisionStatusOptions {
  activeTabId: string;
  vesselsCount: number;
  isConnected: boolean;
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
  vesselsCount,
  isConnected,
  controlError,
  videoState,
}: UseDatavisionStatusOptions) {
  return useMemo(() => {
    const connectionLabel = isConnected ? "Connected" : "Disconnected";
    const videoLabel = `${videoState.transport.toUpperCase()} ${videoState.status}`;
    const videoErrorLabel = videoState.error ? ` | Video error: ${videoState.error}` : "";
    const controlLabel = controlError ? ` | Control: ${controlError}` : "";

    return {
      infoLabel: `${connectionLabel} | Stream: ${activeTabId} | ${videoLabel} | Vessels: ${vesselsCount}${videoErrorLabel}${controlLabel}`,
    };
  }, [
    activeTabId,
    vesselsCount,
    isConnected,
    controlError,
    videoState.transport,
    videoState.status,
    videoState.error,
  ]);
}
