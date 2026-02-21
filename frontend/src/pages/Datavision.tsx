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

  const { vessels, isLoading, error, isConnected } = useDetectionsWebSocket({
    url: wsUrl,
    enabled: wsEnabled,
  });

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
                    {isConnected ? "Connected" : "Disconnected"} | Stream: {activeTabId} |{" "}
                    {videoState.transport.toUpperCase()} {videoState.status} | Vessels:{" "}
                    {vessels.length}
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
