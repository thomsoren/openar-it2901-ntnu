import { useCallback, useEffect, useReducer, useRef } from "react";
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

interface RecoveryState {
  videoSession: number;
  videoState: VideoPlayerState;
  imageLoaded: boolean;
  controlError: string | null;
}

const FIRST_FRAME_WATCHDOG_TIMEOUT_MS = 25_000;

type RecoveryAction =
  | { type: "RESET_STREAM" }
  | { type: "BUMP_SESSION" }
  | { type: "SET_VIDEO_STATE"; payload: VideoPlayerState }
  | { type: "SET_IMAGE_LOADED"; payload: boolean }
  | { type: "SET_CONTROL_ERROR"; payload: string | null };

const initialState: RecoveryState = {
  videoSession: 0,
  videoState: {
    transport: "webrtc",
    status: "idle",
    error: null,
  },
  imageLoaded: false,
  controlError: null,
};

const reducer = (state: RecoveryState, action: RecoveryAction): RecoveryState => {
  switch (action.type) {
    case "RESET_STREAM":
      return {
        ...state,
        videoState: { transport: "webrtc", status: "idle", error: null },
        imageLoaded: false,
        controlError: null,
      };
    case "BUMP_SESSION":
      return {
        videoSession: state.videoSession + 1,
        videoState: { transport: "webrtc", status: "idle", error: null },
        imageLoaded: false,
        controlError: null,
      };
    case "SET_VIDEO_STATE":
      return { ...state, videoState: action.payload };
    case "SET_IMAGE_LOADED":
      return { ...state, imageLoaded: action.payload };
    case "SET_CONTROL_ERROR":
      return { ...state, controlError: action.payload };
    default:
      return state;
  }
};

/**
 * @example
 * ```tsx
 * const recovery = useVideoSessionRecovery({ streamKey: activeTabId });
 * ```
 */
export function useVideoSessionRecovery({
  streamKey,
  maxReconnectAttempts = 8,
}: UseVideoSessionRecoveryOptions): UseVideoSessionRecoveryResult {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { videoSession, videoState, imageLoaded, controlError } = state;
  const setControlError = useCallback((value: string | null) => {
    dispatch({ type: "SET_CONTROL_ERROR", payload: value });
  }, []);

  const imageLoadedRef = useRef(false);
  const controlErrorRef = useRef<string | null>(null);
  const videoStateRef = useRef<VideoPlayerState>(videoState);
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
      if (reconnectTimerRef.current !== null) {
        return;
      }

      if (reconnectCountRef.current >= maxReconnectAttempts) {
        dispatch({
          type: "SET_CONTROL_ERROR",
          payload: `${reason} — gave up after ${maxReconnectAttempts} attempts`,
        });
        return;
      }

      reconnectCountRef.current += 1;
      firstFrameRetryDoneRef.current = false;
      const delay = Math.min(2000 * Math.pow(1.5, reconnectCountRef.current - 1), 15000);
      dispatch({
        type: "SET_CONTROL_ERROR",
        payload: `${reason} (attempt ${reconnectCountRef.current})...`,
      });
      reconnectTimerRef.current = window.setTimeout(() => {
        dispatch({ type: "BUMP_SESSION" });
      }, delay);
    },
    [maxReconnectAttempts]
  );

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      // Don't restart a stream that is already playing — switching browser
      // windows should never interrupt an active video connection.
      if (imageLoadedRef.current) {
        return;
      }

      reconnectCountRef.current = 0;
      firstFrameRetryDoneRef.current = false;
      dispatch({ type: "BUMP_SESSION" });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    reconnectCountRef.current = 0;
    firstFrameRetryDoneRef.current = false;
    dispatch({ type: "RESET_STREAM" });
  }, [streamKey]);

  useEffect(() => {
    controlErrorRef.current = controlError;
  }, [controlError]);

  useEffect(() => {
    videoStateRef.current = videoState;
  }, [videoState]);

  useEffect(() => {
    imageLoadedRef.current = false;
    clearReconnectTimers();

    firstFrameWatchdogRef.current = window.setTimeout(() => {
      if (imageLoadedRef.current || firstFrameRetryDoneRef.current) {
        return;
      }

      const currentVideoState = videoStateRef.current;
      if (currentVideoState.transport !== "webrtc") {
        // HLS fallback can legitimately take longer than first WebRTC setup.
        // Avoid thrashing sessions while fallback is in progress.
        return;
      }
      if (currentVideoState.status === "error") {
        // Error path has its own reconnect scheduling.
        return;
      }

      firstFrameRetryDoneRef.current = true;
      scheduleReconnect("Video stream reconnecting");
    }, FIRST_FRAME_WATCHDOG_TIMEOUT_MS);

    return () => {
      clearReconnectTimers();
    };
  }, [clearReconnectTimers, scheduleReconnect, streamKey, videoSession]);

  useEffect(() => {
    return () => {
      clearReconnectTimers();
    };
  }, [clearReconnectTimers]);

  const handleVideoStatusChange = useCallback(
    (next: VideoPlayerState) => {
      videoStateRef.current = next;
      dispatch({ type: "SET_VIDEO_STATE", payload: next });

      if (next.status === "playing") {
        imageLoadedRef.current = true;
        reconnectCountRef.current = 0;
        dispatch({ type: "SET_IMAGE_LOADED", payload: true });
        clearReconnectTimers();
        const nextControlError = (() => {
          const previous = controlErrorRef.current;
          if (
            previous?.startsWith("Video stream") ||
            previous?.startsWith("Waiting for first video frame") ||
            previous?.startsWith("WebRTC stream") ||
            previous?.startsWith("HLS stream")
          ) {
            return null as string | null;
          }
          return previous;
        })();
        dispatch({ type: "SET_CONTROL_ERROR", payload: nextControlError });
        return;
      }

      if (next.status === "error") {
        imageLoadedRef.current = false;
        dispatch({ type: "SET_IMAGE_LOADED", payload: false });
        scheduleReconnect(
          next.transport === "webrtc" ? "WebRTC stream reconnecting" : "HLS stream reconnecting"
        );
        return;
      }

      if (!imageLoadedRef.current) {
        dispatch({ type: "SET_IMAGE_LOADED", payload: false });
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
