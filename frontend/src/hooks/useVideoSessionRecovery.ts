import { useCallback, useEffect, useReducer, useRef } from "react";
import type { VideoPlayerState } from "../components/video-player/VideoPlayer";

const FIRST_FRAME_WATCHDOG_MS = 10_000;
const BASE_RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 15_000;
const BACKOFF_FACTOR = 1.5;

interface UseVideoSessionRecoveryOptions {
  streamKey: string;
  initialSession?: number;
  maxReconnectAttempts?: number;
}

interface UseVideoSessionRecoveryResult {
  recoveryStreamKey: string;
  videoSession: number;
  videoState: VideoPlayerState;
  imageLoaded: boolean;
  showVideoLoader: boolean;
  controlError: string | null;
  setControlError: (value: string | null) => void;
  handleVideoStatusChange: (next: VideoPlayerState) => void;
  forceReconnect: (reason?: string) => void;
}

interface RecoveryState {
  recoveryStreamKey: string;
  videoSession: number;
  videoState: VideoPlayerState;
  imageLoaded: boolean;
  controlError: string | null;
}

type RecoveryAction =
  | { type: "RESET_STREAM"; streamKey: string; session: number }
  | { type: "BUMP_SESSION" }
  | { type: "SET_VIDEO_STATE"; payload: VideoPlayerState }
  | { type: "SET_IMAGE_LOADED"; payload: boolean }
  | { type: "SET_CONTROL_ERROR"; payload: string | null };

const initialState: RecoveryState = {
  recoveryStreamKey: "",
  videoSession: 0,
  videoState: { transport: "webrtc", status: "idle", error: null },
  imageLoaded: false,
  controlError: null,
};

function reducer(state: RecoveryState, action: RecoveryAction): RecoveryState {
  switch (action.type) {
    case "RESET_STREAM":
      return {
        ...state,
        recoveryStreamKey: action.streamKey,
        videoSession: action.session,
        videoState: { transport: "webrtc", status: "idle", error: null },
        imageLoaded: false,
        controlError: null,
      };
    case "BUMP_SESSION":
      return {
        recoveryStreamKey: state.recoveryStreamKey,
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
}

export function useVideoSessionRecovery({
  streamKey,
  initialSession = 0,
  maxReconnectAttempts = 8,
}: UseVideoSessionRecoveryOptions): UseVideoSessionRecoveryResult {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { recoveryStreamKey, videoSession, videoState, imageLoaded, controlError } = state;

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
  const previousStreamKeyRef = useRef<string | null>(null);

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
      if (reconnectTimerRef.current !== null) return;

      if (reconnectCountRef.current >= maxReconnectAttempts) {
        dispatch({
          type: "SET_CONTROL_ERROR",
          payload: `${reason} — gave up after ${maxReconnectAttempts} attempts`,
        });
        return;
      }

      reconnectCountRef.current += 1;
      firstFrameRetryDoneRef.current = false;
      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * Math.pow(BACKOFF_FACTOR, reconnectCountRef.current - 1),
        MAX_RECONNECT_DELAY_MS
      );
      dispatch({
        type: "SET_CONTROL_ERROR",
        payload: `${reason} (attempt ${reconnectCountRef.current})...`,
      });
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        dispatch({ type: "BUMP_SESSION" });
      }, delay);
    },
    [maxReconnectAttempts]
  );

  // Visibility change: reconnect when tab becomes visible again (if not already playing)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (imageLoadedRef.current) return;

      reconnectCountRef.current = 0;
      firstFrameRetryDoneRef.current = false;
      dispatch({ type: "BUMP_SESSION" });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Stream key change: reset all recovery state
  useEffect(() => {
    if (previousStreamKeyRef.current === streamKey) return;
    previousStreamKeyRef.current = streamKey;
    reconnectCountRef.current = 0;
    firstFrameRetryDoneRef.current = false;
    dispatch({ type: "RESET_STREAM", streamKey, session: initialSession });
  }, [initialSession, streamKey]);

  // Keep refs in sync
  useEffect(() => {
    controlErrorRef.current = controlError;
  }, [controlError]);
  useEffect(() => {
    videoStateRef.current = videoState;
  }, [videoState]);

  // First-frame watchdog: schedule reconnect if no frame arrives within timeout
  useEffect(() => {
    imageLoadedRef.current = false;
    clearReconnectTimers();

    firstFrameWatchdogRef.current = window.setTimeout(() => {
      if (imageLoadedRef.current || firstFrameRetryDoneRef.current) return;

      const current = videoStateRef.current;
      if (current.transport !== "webrtc") return;
      if (current.status === "error") return;

      firstFrameRetryDoneRef.current = true;
      scheduleReconnect("Video stream reconnecting");
    }, FIRST_FRAME_WATCHDOG_MS);

    return () => clearReconnectTimers();
  }, [clearReconnectTimers, scheduleReconnect, streamKey, videoSession]);

  // Cleanup on unmount
  useEffect(() => () => clearReconnectTimers(), [clearReconnectTimers]);

  const handleVideoStatusChange = useCallback(
    (next: VideoPlayerState) => {
      videoStateRef.current = next;
      dispatch({ type: "SET_VIDEO_STATE", payload: next });

      if (next.status === "playing") {
        imageLoadedRef.current = true;
        reconnectCountRef.current = 0;
        dispatch({ type: "SET_IMAGE_LOADED", payload: true });
        clearReconnectTimers();

        const prev = controlErrorRef.current;
        const isRecoveryError =
          prev?.startsWith("Video stream") ||
          prev?.startsWith("Waiting for first video frame") ||
          prev?.startsWith("WebRTC stream") ||
          prev?.startsWith("HLS stream");
        dispatch({ type: "SET_CONTROL_ERROR", payload: isRecoveryError ? null : prev });
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

  const forceReconnect = useCallback(
    (reason: string = "Recovering stream...") => {
      reconnectCountRef.current = 0;
      firstFrameRetryDoneRef.current = false;
      imageLoadedRef.current = false;
      clearReconnectTimers();
      dispatch({ type: "SET_IMAGE_LOADED", payload: false });
      dispatch({ type: "SET_CONTROL_ERROR", payload: reason });
      dispatch({ type: "BUMP_SESSION" });
    },
    [clearReconnectTimers]
  );

  return {
    recoveryStreamKey,
    videoSession,
    videoState,
    imageLoaded,
    showVideoLoader: !imageLoaded || videoState.status === "connecting",
    controlError,
    setControlError,
    handleVideoStatusChange,
    forceReconnect,
  };
}
