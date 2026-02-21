import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ObcTabRow } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import { ObcProgressBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/progress-bar/progress-bar";
import {
  CircularProgressState,
  ProgressBarMode,
  ProgressBarType,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/progress-bar/progress-bar.js";
import PoiOverlay from "../components/poi-overlay/PoiOverlay";
import VideoPlayer, { type VideoPlayerState } from "../components/video-player/VideoPlayer";
import { useDetectionsWebSocket } from "../hooks/useDetectionsWebSocket";
import { useStreamTabs } from "../hooks/useStreamTabs";
import { useVideoTransform } from "../hooks/useVideoTransform";
import { useSettings } from "../contexts/useSettings";
import { useAuth } from "../hooks/useAuth";
import { DETECTION_CONFIG } from "../config/video";
import { apiFetch as apiFetchLib } from "../lib/api-client";
import { readJsonSafely, explainFetchError } from "../utils/api-helpers";
import AuthGate from "../components/auth/AuthGate";
import StreamSetup from "../components/stream-setup/StreamSetup";
import "./Datavision.css";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DatavisionProps {
  /** Set by App.tsx when the user picks a stream from the navigation menu. */
  externalStreamId?: string | null;
  onAuthGateVisibleChange?: (visible: boolean) => void;
}

function Datavision({ externalStreamId, onAuthGateVisibleChange }: DatavisionProps = {}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { videoFitMode, detectionVisible, multiStreamTestingEnabled } = useSettings();
  const auth = useAuth();

  // --- Tab / stream state (extracted hook) ---
  const {
    tabs,
    activeTabId,
    showAddButton,
    showCloseButtons,
    activeIsSetup,
    activeStream,
    wsEnabled,
    handleTabSelected,
    handleTabClosed,
    handleAddTab,
    handleStreamReady,
    configureTabId,
    streamError,
  } = useStreamTabs({ externalStreamId, multiStreamTestingEnabled });

  // --- Video state ---
  const [controlError, setControlError] = useState<string | null>(null);
  const [videoSession, setVideoSession] = useState(0);
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
  const [clockTickMs, setClockTickMs] = useState(() => performance.now());
  const detectionClockRef = useRef<Record<string, { timestampMs: number; perfMs: number }>>({});
  const frameClockRef = useRef<Record<string, { timestampMs: number; perfMs: number }>>({});
  const [videoDisplayMs, setVideoDisplayMs] = useState(0);
  const pendingLatencyRef = useRef<Array<{ sourceTsMs: number; frameSentAtMs: number }>>([]);
  const [lastDisplayLatencyMs, setLastDisplayLatencyMs] = useState<number | null>(null);
  const [displayLatencySamples, setDisplayLatencySamples] = useState<number[]>([]);
  const MAX_RECONNECT_ATTEMPTS = 8;

  const showingAuthGate = activeIsSetup && !auth.session;

  useEffect(() => {
    onAuthGateVisibleChange?.(showingAuthGate);
  }, [showingAuthGate, onAuthGateVisibleChange]);

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
      if (reconnectCountRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setControlError(`${reason} — gave up after ${MAX_RECONNECT_ATTEMPTS} attempts`);
        return;
      }
      reconnectCountRef.current += 1;
      const delay = Math.min(2000 * Math.pow(1.5, reconnectCountRef.current - 1), 15000);
      setControlError(`${reason} (attempt ${reconnectCountRef.current})...`);
      reconnectTimerRef.current = window.setTimeout(() => {
        setVideoSession((prev) => prev + 1);
      }, delay);
    },
    [MAX_RECONNECT_ATTEMPTS]
  );

  const wsUrl = useMemo(() => DETECTION_CONFIG.WS_URL(activeTabId), [activeTabId]);

  const {
    vessels,
    isLoading,
    error,
    isConnected,
    detectionTimestampMs,
    frameTimestampMs,
    frameSentAtMs,
  } = useDetectionsWebSocket({ url: wsUrl, enabled: wsEnabled });

  const videoTransform = useVideoTransform(
    videoRef,
    containerRef,
    videoFitMode,
    undefined,
    undefined,
    imageLoaded
  );

  // --- Tab close with backend DELETE ---
  const onTabClosed = useCallback(
    async (event: CustomEvent<{ id?: string }>) => {
      const tabId = event.detail?.id?.trim();
      if (!tabId || tabId === "default") return;

      const wasSetup = configureTabId === tabId;
      handleTabClosed(tabId);

      if (!wasSetup) {
        try {
          const response = await apiFetchLib(`/api/streams/${encodeURIComponent(tabId)}`, {
            method: "DELETE",
          });
          if (!response.ok && response.status !== 404) {
            const payload = (await readJsonSafely(response)) as { detail?: string };
            throw new Error(payload.detail || "Failed to stop stream");
          }
        } catch (err) {
          setControlError(explainFetchError(err, "Failed to stop stream"));
        }
      }
    },
    [configureTabId, handleTabClosed]
  );

  // When the browser tab becomes visible again, force a fresh stream connection.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        reconnectCountRef.current = 0;
        firstFrameRetryDoneRef.current = false;
        setVideoSession((prev) => prev + 1);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Reset video state when stream or session changes
  useEffect(() => {
    reconnectCountRef.current = 0;
    firstFrameRetryDoneRef.current = false;
    setControlError(null);
    pendingLatencyRef.current = [];
    setLastDisplayLatencyMs(null);
    setDisplayLatencySamples([]);
    setVideoDisplayMs(0);
    setVideoState({
      transport: "webrtc",
      status: "idle",
      error: null,
    });
  }, [activeTabId, videoSession]);

  useEffect(() => {
    imageLoadedRef.current = false;
    setImageLoaded(false);
    clearReconnectTimers();
    firstFrameWatchdogRef.current = window.setTimeout(() => {
      if (imageLoadedRef.current) {
        return;
      }
      if (firstFrameRetryDoneRef.current) {
        return;
      }
      firstFrameRetryDoneRef.current = true;
      scheduleReconnect("Video stream reconnecting");
    }, 10000);

    return () => {
      clearReconnectTimers();
    };
  }, [activeTabId, clearReconnectTimers, scheduleReconnect]);

  useEffect(() => {
    return () => {
      clearReconnectTimers();
    };
  }, [clearReconnectTimers]);

  const activeStreamPlayback = activeStream?.playback_urls ?? null;
  const showVideoLoader = !imageLoaded || videoState.status === "connecting";

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClockTickMs(performance.now());
      const videoEl = videoRef.current;
      if (videoEl) {
        const current = Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0;
        setVideoDisplayMs(Math.max(0, current * 1000));
      }
    }, 200);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (detectionTimestampMs <= 0) {
      return;
    }
    detectionClockRef.current[activeTabId] = {
      timestampMs: detectionTimestampMs,
      perfMs: performance.now(),
    };
  }, [activeTabId, detectionTimestampMs]);

  useEffect(() => {
    if (frameTimestampMs <= 0 || frameSentAtMs <= 0) {
      return;
    }
    pendingLatencyRef.current.push({
      sourceTsMs: frameTimestampMs,
      frameSentAtMs,
    });
    if (pendingLatencyRef.current.length > 300) {
      pendingLatencyRef.current.splice(0, pendingLatencyRef.current.length - 300);
    }
  }, [frameTimestampMs, frameSentAtMs]);

  useEffect(() => {
    if (frameTimestampMs <= 0) {
      return;
    }
    frameClockRef.current[activeTabId] = {
      timestampMs: frameTimestampMs,
      perfMs: performance.now(),
    };
  }, [activeTabId, frameTimestampMs]);

  useEffect(() => {
    const pending = pendingLatencyRef.current;
    if (pending.length === 0) {
      return;
    }
    const effectiveClockMs = videoDisplayMs > 0 ? videoDisplayMs : frameTimestampMs;
    if (effectiveClockMs <= 0) {
      return;
    }

    while (pending.length > 0 && pending[0].sourceTsMs <= effectiveClockMs) {
      const sample = pending.shift();
      if (!sample) {
        break;
      }
      const latencyMs = Math.max(0, Date.now() - sample.frameSentAtMs);
      setLastDisplayLatencyMs(latencyMs);
      setDisplayLatencySamples((prev) => {
        const next = [...prev, latencyMs];
        if (next.length > 200) {
          next.splice(0, next.length - 200);
        }
        return next;
      });
    }
  }, [frameTimestampMs, videoDisplayMs]);

  const detectionClockMs = useMemo(() => {
    const saved = detectionClockRef.current[activeTabId];
    if (!saved) {
      return Math.max(0, detectionTimestampMs);
    }
    const delta = Math.max(0, clockTickMs - saved.perfMs);
    return Math.max(saved.timestampMs, saved.timestampMs + delta);
  }, [activeTabId, clockTickMs, detectionTimestampMs]);

  const frameClockMs = useMemo(() => {
    const saved = frameClockRef.current[activeTabId];
    if (!saved) {
      return Math.max(0, frameTimestampMs);
    }
    const delta = Math.max(0, clockTickMs - saved.perfMs);
    return Math.max(saved.timestampMs, saved.timestampMs + delta);
  }, [activeTabId, clockTickMs, frameTimestampMs]);

  const videoClockMs = useMemo(() => {
    if (videoDisplayMs > 0) {
      return videoDisplayMs;
    }
    return frameClockMs;
  }, [frameClockMs, videoDisplayMs]);

  const detectionDisplayClockMs = useMemo(() => {
    if (videoClockMs > 0) {
      return videoClockMs;
    }
    return detectionClockMs;
  }, [videoClockMs, detectionClockMs]);

  const secondsSinceLastUpdate = useMemo(() => {
    const saved = detectionClockRef.current[activeTabId];
    if (!saved) {
      return 0;
    }
    return Math.max(0, (clockTickMs - saved.perfMs) / 1000);
  }, [activeTabId, clockTickMs]);

  const latencyStats = useMemo(() => {
    if (displayLatencySamples.length === 0) {
      return { p50: null as number | null, p95: null as number | null };
    }
    const sorted = [...displayLatencySamples].sort((a, b) => a - b);
    const percentile = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
    return {
      p50: percentile(0.5),
      p95: percentile(0.95),
    };
  }, [displayLatencySamples]);

  const formatClock = (ms: number) =>
    `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

  const handleVideoStatusChange = useCallback(
    (next: VideoPlayerState) => {
      setVideoState(next);

      if (next.status === "playing") {
        imageLoadedRef.current = true;
        reconnectCountRef.current = 0;
        setImageLoaded(true);
        clearReconnectTimers();
        setControlError((prev) => {
          if (
            prev?.startsWith("Video stream") ||
            prev?.startsWith("Waiting for first video frame") ||
            prev?.startsWith("WebRTC stream") ||
            prev?.startsWith("HLS stream")
          ) {
            return null;
          }
          return prev;
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

  // Merge stream errors from the hook into controlError
  const displayError = controlError || streamError;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <section className="stream-workspace">
        <div className="stream-tabs-shell">
          <ObcTabRow
            className="stream-tab-row"
            tabs={tabs}
            selectedTabId={activeTabId}
            hasAddNewTab={showAddButton}
            hasClose={showCloseButtons}
            onTabSelected={handleTabSelected}
            onTabClosed={onTabClosed}
            onAddNewTab={handleAddTab}
          />

          <div
            ref={containerRef}
            className={[
              "stream-card-content",
              activeIsSetup ? "" : !activeStream ? "stream-card-content--empty" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {activeIsSetup && (
              <>
                {!auth.session ? (
                  <div className="stream-setup-auth">
                    <AuthGate initialMode="login" onAuthenticated={auth.handleAuthenticated} />
                  </div>
                ) : (
                  <StreamSetup tabId={activeTabId} onStreamReady={handleStreamReady} />
                )}
              </>
            )}

            {!activeIsSetup &&
              !activeStream &&
              "No running streams. Join or create one from the sidebar."}

            {!activeIsSetup && activeStream && (
              <>
                <VideoPlayer
                  key={`${activeTabId}-${videoSession}`}
                  streamId={activeStream.stream_id}
                  whepUrl={activeStreamPlayback?.whep_url}
                  hlsUrl={activeStreamPlayback?.hls_url}
                  sessionToken={videoSession}
                  className="background-video"
                  style={{ objectFit: videoFitMode, backgroundColor: "#e5e9ef" }}
                  onVideoReady={(videoEl) => {
                    videoRef.current = videoEl;
                  }}
                  onStatusChange={handleVideoStatusChange}
                />

                {showVideoLoader && (
                  <div className="video-loading-center">
                    <ObcProgressBar
                      className="video-loading-center__progress"
                      type={ProgressBarType.circular}
                      mode={ProgressBarMode.indeterminate}
                      circularState={CircularProgressState.indeterminate}
                      style={
                        {
                          "--instrument-enhanced-secondary-color": "#4ea9dd",
                          "--container-backdrop-color": "rgba(68, 88, 112, 0.22)",
                        } as CSSProperties
                      }
                    >
                      <span slot="icon"></span>
                    </ObcProgressBar>
                    <div className="video-loading-center__label">
                      {!imageLoaded ? "Connecting to video stream..." : "Waiting for detections..."}
                    </div>
                  </div>
                )}
                {isLoading && imageLoaded && (
                  <div className="status-overlay">Connecting to detection stream...</div>
                )}
                {error && <div className="status-overlay status-error">Error: {error}</div>}
                {!isLoading && !error && (
                  <div className="status-overlay status-info">
                    {isConnected ? "Connected" : "Disconnected"} | Stream: {activeTabId} | Video
                    Time: {formatClock(videoClockMs)} | Detection Time:{" "}
                    {formatClock(detectionDisplayClockMs)}{" "}
                    {`(+${secondsSinceLastUpdate.toFixed(1)}s)`} | Video:{" "}
                    {videoState.transport.toUpperCase()} {videoState.status}
                    {lastDisplayLatencyMs !== null
                      ? ` | Display latency: ${Math.round(lastDisplayLatencyMs)}ms${latencyStats.p50 !== null && latencyStats.p95 !== null ? ` (p50 ${Math.round(latencyStats.p50)} / p95 ${Math.round(latencyStats.p95)})` : ""}`
                      : ""}
                    | Vessels: {vessels.length}
                    {videoState.error ? ` | Video error: ${videoState.error}` : ""}
                    {displayError ? ` | Control: ${displayError}` : ""}
                  </div>
                )}

                {detectionVisible && (
                  <PoiOverlay vessels={vessels} videoTransform={videoTransform} />
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export default Datavision;
