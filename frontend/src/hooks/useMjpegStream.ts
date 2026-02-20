import { useCallback, useEffect, useRef, useState } from "react";
import { API_CONFIG } from "../config/video";

const MAX_RECONNECT_ATTEMPTS = 8;

interface MjpegStreamResult {
  imgSrc: string;
  imageLoaded: boolean;
  reconnectError: string | null;
  onLoad: () => void;
  onError: () => void;
}

export function useMjpegStream(streamId: string, enabled: boolean): MjpegStreamResult {
  const [videoSession, setVideoSession] = useState(0);
  // Track which streamId successfully loaded rather than a plain boolean.
  // imageLoaded is derived: true only when the current streamId matches.
  const [loadedStreamId, setLoadedStreamId] = useState<string | null>(null);
  const [reconnectError, setReconnectError] = useState<string | null>(null);

  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectCountRef = useRef(0);
  const imageLoadedRef = useRef(false);

  const imageLoaded = loadedStreamId === streamId;

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) return;

    if (reconnectCountRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setReconnectError(`Video stream '${streamId}' unavailable. Retrying in 30s...`);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        reconnectCountRef.current = 0;
        setVideoSession((v) => v + 1);
      }, 30_000);
      return;
    }

    reconnectCountRef.current += 1;
    const delayMs = 250 + reconnectCountRef.current * 250;
    setReconnectError(
      `Video stream reconnecting '${streamId}' (${reconnectCountRef.current}/${MAX_RECONNECT_ATTEMPTS})...`
    );
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      setVideoSession((v) => v + 1);
    }, delayMs);
  }, [streamId]);

  // First-frame watchdog: if no frame arrives within 6s, trigger reconnect.
  // Also resets reconnect state when streamId changes.
  useEffect(() => {
    reconnectCountRef.current = 0;
    imageLoadedRef.current = false;
    if (!enabled) {
      clearTimers();
      return;
    }
    clearTimers();

    const watchdog = window.setTimeout(() => {
      if (!imageLoadedRef.current) {
        scheduleReconnect();
      }
    }, 6000);

    return () => {
      window.clearTimeout(watchdog);
      clearTimers();
    };
  }, [streamId, enabled, videoSession, clearTimers, scheduleReconnect]);

  // Force fresh connection when browser tab becomes visible
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        reconnectCountRef.current = 0;
        setVideoSession((v) => v + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Cleanup on unmount
  useEffect(() => clearTimers, [clearTimers]);

  const onLoad = useCallback(() => {
    imageLoadedRef.current = true;
    reconnectCountRef.current = 0;
    setLoadedStreamId(streamId);
    clearTimers();
    setReconnectError(null);
  }, [streamId, clearTimers]);

  const onError = useCallback(() => {
    imageLoadedRef.current = false;
    setLoadedStreamId(null);
    scheduleReconnect();
  }, [scheduleReconnect]);

  const apiBase = API_CONFIG.BASE_URL.replace(/\/$/, "");
  const imgSrc = `${apiBase}/api/video/mjpeg/${streamId}?v=${videoSession}`;

  // Only surface errors belonging to the current stream
  const effectiveError =
    reconnectError && reconnectError.includes(streamId) ? reconnectError : null;

  return {
    imgSrc,
    imageLoaded,
    reconnectError: effectiveError,
    onLoad,
    onError,
  };
}
