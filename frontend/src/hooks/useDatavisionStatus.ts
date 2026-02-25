import { useMemo } from "react";
import type { VideoPlayerState } from "../components/video-player/VideoPlayer";

interface UseDatavisionStatusOptions {
  activeTabId: string;
  vesselsCount: number;
  isConnected: boolean;
  controlError: string | null;
  videoState: VideoPlayerState;
}

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
