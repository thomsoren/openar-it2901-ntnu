import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoPlayerState } from "../components/video-player/VideoPlayer";

interface UseVideoSessionRecoveryOptions {
  streamKey: string;
  maxReconnectAttempts?: number;
}

interface UseVideoSessionRecoveryResult {
  videoSession: number;
  videoState: VideoPlayerState;
  imageLoaded: boolean;
  showVideoLoader: boolean;
  controlError: string | null;
  setControlError: (value: string | null) => void;
  handleVideoStatusChange: (next: VideoPlayerState) => void;
}

export function useVideoSessionRecovery({
  streamKey,
  maxReconnectAttempts = 8,
}: UseVideoSessionRecoveryOptions): UseVideoSessionRecoveryResult {
  const [videoSession, setVideoSession] = useState(0);
  const [controlError, setControlError] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<VideoPlayerState>({
    transport: "webrtc",
    status: "idle",
    error: null,
  });
  const [imageLoaded, setImageLoaded] = useState(false);

  const imageLoadedRef = useRef(false);
  const reconnectCountRef = useRef(0);
  const firstFrameRetryDoneRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const firstFrameWatchdogRef = useRef<number | null>(null);

  const clearReconnectTimers = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (firstFrameWatchdogRef.current !== null) {
      window.clearTimeout(firstFrameWatchdogRef.current);
      firstFrameWatchdogRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(
    (reason: string) => {
      if (reconnectCountRef.current >= maxReconnectAttempts) {
        setControlError(`${reason} — gave up after ${maxReconnectAttempts} attempts`);
        return;
      }

      reconnectCountRef.current += 1;
      const delay = Math.min(2000 * Math.pow(1.5, reconnectCountRef.current - 1), 15000);
      setControlError(`${reason} (attempt ${reconnectCountRef.current})...`);
      reconnectTimerRef.current = window.setTimeout(() => {
        setVideoSession((previous) => previous + 1);
      }, delay);
    },
    [maxReconnectAttempts]
  );

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      reconnectCountRef.current = 0;
      firstFrameRetryDoneRef.current = false;
      setVideoSession((previous) => previous + 1);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    reconnectCountRef.current = 0;
    firstFrameRetryDoneRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setControlError(null);
    setVideoState({
      transport: "webrtc",
      status: "idle",
      error: null,
    });
  }, [streamKey, videoSession]);

  useEffect(() => {
    imageLoadedRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImageLoaded(false);
    clearReconnectTimers();

    firstFrameWatchdogRef.current = window.setTimeout(() => {
      if (imageLoadedRef.current || firstFrameRetryDoneRef.current) {
        return;
      }

      firstFrameRetryDoneRef.current = true;
      scheduleReconnect("Video stream reconnecting");
    }, 10000);

    return () => {
      clearReconnectTimers();
    };
  }, [clearReconnectTimers, scheduleReconnect, streamKey]);

  useEffect(() => {
    return () => {
      clearReconnectTimers();
    };
  }, [clearReconnectTimers]);

  const handleVideoStatusChange = useCallback(
    (next: VideoPlayerState) => {
      setVideoState(next);

      if (next.status === "playing") {
        imageLoadedRef.current = true;
        reconnectCountRef.current = 0;
        setImageLoaded(true);
        clearReconnectTimers();
        setControlError((previous) => {
          if (
            previous?.startsWith("Video stream") ||
            previous?.startsWith("Waiting for first video frame") ||
            previous?.startsWith("WebRTC stream") ||
            previous?.startsWith("HLS stream")
          ) {
            return null;
          }
          return previous;
        });
        return;
      }

      if (next.status === "error") {
        imageLoadedRef.current = false;
        setImageLoaded(false);
        scheduleReconnect(
          next.transport === "webrtc" ? "WebRTC stream reconnecting" : "HLS stream reconnecting"
        );
        return;
      }

      if (!imageLoadedRef.current) {
        setImageLoaded(false);
      }
    },
    [clearReconnectTimers, scheduleReconnect]
  );

  return {
    videoSession,
    videoState,
    imageLoaded,
    showVideoLoader: !imageLoaded || videoState.status === "connecting",
    controlError,
    setControlError,
    handleVideoStatusChange,
  };
}
