import { useCallback, useEffect, useMemo, useRef } from "react";
import { ObcProgressBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/progress-bar/progress-bar";
import { ObcTag } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tag/tag";
import {
  CircularProgressState,
  ProgressBarMode,
  ProgressBarType,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/progress-bar/progress-bar.js";
import PoiOverlay from "../components/poi-overlay/PoiOverlay";
import PoiErrorBoundary from "../components/poi-overlay/PoiErrorBoundary";
import VideoPlayer from "../components/video-player/VideoPlayer";
import { ARControlProvider } from "../components/ar-control-panel/ARControlProvider";
import { useDetectionsWebSocket } from "../hooks/useDetectionsWebSocket";
import { useStreamTabs } from "../hooks/useStreamTabs";
import { useVideoTransform } from "../hooks/useVideoTransform";
import { useVideoSessionRecovery } from "../hooks/useVideoSessionRecovery";
import { useARControls } from "../components/ar-control-panel/useARControls";
import { useAuth } from "../hooks/useAuth";
import { DETECTION_CONFIG, MOCK_DATA_CONFIG } from "../config/video";
import AuthGate from "../components/auth/AuthGate";
import StreamSetup from "../components/stream-setup/StreamSetup";
import { startStream, stopStream, toStreamError } from "../services/streams";
import { useInterpolatedDetections } from "../hooks/useInterpolatedDetections";
import { StreamWorkspaceHeader } from "../components/app/StreamWorkspaceHeader";
import { DEFAULT_STREAM_ID, FUSION_TAB_ID, MOCK_DATA_TAB_ID } from "../hooks/stream-tabs/constants";
import { apiFetchPublic } from "../lib/api-client";
import "./AROverlay.css";

const DETECTION_STALE_RECOVERY_MS = 10_000;
const DETECTION_RECOVERY_COOLDOWN_MS = 8_000;

interface AROverlayProps {
  externalStreamId?: string | null;
  onAuthGateVisibleChange?: (visible: boolean) => void;
}

function WorkspaceLoader({ label }: { label: string }) {
  return (
    <div className="video-loading-center">
      <ObcProgressBar
        className="video-loading-center__progress"
        type={ProgressBarType.circular}
        mode={ProgressBarMode.indeterminate}
        circularState={CircularProgressState.indeterminate}
      >
        <span slot="icon"></span>
      </ObcProgressBar>
      <ObcTag className="video-loading-center__label" label={label} />
    </div>
  );
}

function AROverlayInner({ externalStreamId, onAuthGateVisibleChange }: AROverlayProps = {}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mockDataVideoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fusionStartInFlightRef = useRef(false);
  const fusionStartLastAttemptMsRef = useRef(0);
  const detectionRecoveryLastAtRef = useRef(0);
  const { state: arControls } = useARControls();
  const auth = useAuth();

  const {
    tabs,
    activeTabId,
    isTabsHydrated,
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
    warmStreamIds,
    refreshStreams,
    runningStreams,
  } = useStreamTabs({ externalStreamId });

  const { videoSession, imageLoaded, showVideoLoader, setControlError, handleVideoStatusChange } =
    useVideoSessionRecovery({ streamKey: activeTabId });

  const showingAuthGate = activeIsSetup && !auth.session;
  const mediaAuthLoading = Boolean(auth.session) && auth.authBridgeStatus === "loading";
  const mediaAuthError = Boolean(auth.session) && auth.authBridgeStatus === "error";
  const mediaAuthReady = !auth.session || auth.authBridgeStatus === "ready";
  const activeIsMockData = activeTabId === MOCK_DATA_TAB_ID;
  const fusionRunningStream = useMemo(
    () => runningStreams.find((stream) => stream.stream_id === FUSION_TAB_ID) ?? null,
    [runningStreams]
  );
  const effectiveActiveStream = activeTabId === FUSION_TAB_ID ? fusionRunningStream : activeStream;
  const activePlayableStreamId =
    !activeIsSetup && !activeIsMockData && effectiveActiveStream
      ? effectiveActiveStream.stream_id
      : null;

  useEffect(() => {
    onAuthGateVisibleChange?.(showingAuthGate);
  }, [showingAuthGate, onAuthGateVisibleChange]);

  const detectionWsUrl = useMemo(() => DETECTION_CONFIG.WS_URL(activeTabId), [activeTabId]);
  const { vessels, videoInfo, lastMessageAtMs, connect, disconnect } = useDetectionsWebSocket({
    url: detectionWsUrl,
    enabled:
      wsEnabled &&
      !activeIsMockData &&
      (activeTabId !== FUSION_TAB_ID || Boolean(fusionRunningStream)),
  });
  const { vessels: mockDataVessels, videoInfo: mockDataVideoInfo } = useDetectionsWebSocket({
    url: MOCK_DATA_CONFIG.WS_URL,
    enabled: wsEnabled && activeIsMockData,
  });
  const overlayVessels = activeIsMockData ? mockDataVessels : vessels;
  const streamsById = useMemo(
    () => new Map(runningStreams.map((stream) => [stream.stream_id, stream] as const)),
    [runningStreams]
  );

  const handleActiveVideoReady = useCallback((videoEl: HTMLVideoElement) => {
    videoRef.current = videoEl;
  }, []);

  const handleMockVideoRef = useCallback((videoEl: HTMLVideoElement | null) => {
    mockDataVideoRef.current = videoEl;
  }, []);

  const cachedStreamIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];

    const ordered = activePlayableStreamId
      ? [activePlayableStreamId, ...warmStreamIds]
      : warmStreamIds;

    for (const streamId of ordered) {
      if (!streamId || seen.has(streamId)) {
        continue;
      }
      if (!streamsById.has(streamId)) {
        continue;
      }
      seen.add(streamId);
      ids.push(streamId);
      if (ids.length >= 3) {
        break;
      }
    }

    return ids;
  }, [activePlayableStreamId, warmStreamIds, streamsById]);

  const videoTransform = useVideoTransform(
    videoRef,
    containerRef,
    arControls.videoFitMode,
    undefined,
    undefined,
    imageLoaded
  );
  const mockDataVideoTransform = useVideoTransform(
    mockDataVideoRef,
    containerRef,
    arControls.videoFitMode,
    MOCK_DATA_CONFIG.WIDTH,
    MOCK_DATA_CONFIG.HEIGHT,
    activeIsMockData
  );
  const activeVideoTransform = activeIsMockData ? mockDataVideoTransform : videoTransform;
  const activeDetectionFrame = activeIsMockData ? mockDataVideoInfo : videoInfo;
  const interpolatedVessels = useInterpolatedDetections(overlayVessels, {
    motionDirectionScaleX:
      activeDetectionFrame?.width && activeDetectionFrame.width > 0
        ? activeVideoTransform.sourceWidth / activeDetectionFrame.width
        : 1,
    motionDirectionScaleY:
      activeDetectionFrame?.height && activeDetectionFrame.height > 0
        ? activeVideoTransform.sourceHeight / activeDetectionFrame.height
        : 1,
    cameraHeadingDeg: activeDetectionFrame?.cameraHeadingDeg,
  });

  useEffect(() => {
    if (!activeIsMockData) return;
    let cancelled = false;
    apiFetchPublic(MOCK_DATA_CONFIG.RESET_URL, { method: "POST" })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          /* Reset triggers fusion timer; WebSocket streams data */
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeIsMockData]);

  useEffect(() => {
    if (activeTabId !== FUSION_TAB_ID || fusionRunningStream) {
      return;
    }
    const now = Date.now();
    if (fusionStartInFlightRef.current || now - fusionStartLastAttemptMsRef.current < 1500) {
      return;
    }
    fusionStartInFlightRef.current = true;
    fusionStartLastAttemptMsRef.current = now;

    let cancelled = false;
    const ensureFusionStreamRunning = async () => {
      try {
        await startStream(FUSION_TAB_ID, {
          assetName: "fusion_video_gunnerus",
          loop: true,
          allowExisting: true,
        });
      } catch (err) {
        if (!cancelled) {
          setControlError(toStreamError(err, "Failed to start Fusion stream"));
        }
      } finally {
        fusionStartInFlightRef.current = false;
      }
      if (!cancelled) {
        await refreshStreams();
      }
    };

    void ensureFusionStreamRunning();
    return () => {
      cancelled = true;
    };
  }, [activeTabId, fusionRunningStream, refreshStreams, setControlError]);

  // Detection stale recovery: reconnect WebSocket if no messages for too long
  useEffect(() => {
    if (
      !isTabsHydrated ||
      activeIsSetup ||
      activeIsMockData ||
      !mediaAuthReady ||
      !effectiveActiveStream ||
      !imageLoaded
    ) {
      return;
    }

    const now = Date.now();
    const isStale = lastMessageAtMs <= 0 || now - lastMessageAtMs > DETECTION_STALE_RECOVERY_MS;
    if (!isStale) {
      return;
    }
    if (now - detectionRecoveryLastAtRef.current < DETECTION_RECOVERY_COOLDOWN_MS) {
      return;
    }
    detectionRecoveryLastAtRef.current = now;
    disconnect();
    const timer = window.setTimeout(() => {
      connect();
    }, 180);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    activeIsSetup,
    activeIsMockData,
    connect,
    disconnect,
    effectiveActiveStream,
    imageLoaded,
    isTabsHydrated,
    lastMessageAtMs,
    mediaAuthReady,
  ]);

  const onTabClosed = useCallback(
    async (event: CustomEvent<{ id?: string }>) => {
      const tabId = event.detail?.id?.trim();
      if (
        !tabId ||
        tabId === DEFAULT_STREAM_ID ||
        tabId === MOCK_DATA_TAB_ID ||
        tabId === FUSION_TAB_ID
      ) {
        return;
      }

      const wasSetup = configureTabId === tabId;
      handleTabClosed(tabId);

      if (!wasSetup) {
        try {
          await stopStream(tabId);
        } catch (err) {
          setControlError(toStreamError(err, "Failed to stop stream"));
        }
      }
    },
    [configureTabId, handleTabClosed, setControlError]
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <section className="stream-workspace">
        <div className="stream-tabs-shell">
          <StreamWorkspaceHeader
            tabs={tabs}
            activeTabId={activeTabId}
            showAddButton={isTabsHydrated && showAddButton}
            showCloseButtons={isTabsHydrated && showCloseButtons}
            runningStreams={runningStreams}
            configureTabId={configureTabId}
            onTabSelected={handleTabSelected}
            onTabClosed={onTabClosed}
            onAddTab={handleAddTab}
          />

          <div
            ref={containerRef}
            className={[
              "stream-card-content",
              activeIsSetup
                ? ""
                : activeIsMockData
                  ? "stream-card-content--video-tab"
                  : !effectiveActiveStream
                    ? "stream-card-content--empty"
                    : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {!isTabsHydrated && <WorkspaceLoader label="Restoring workspace..." />}

            {isTabsHydrated && activeIsSetup && (
              <>
                {!auth.session ? (
                  <div className="stream-setup-auth">
                    <AuthGate initialMode="login" onAuthenticated={auth.handleAuthenticated} />
                  </div>
                ) : !mediaAuthReady ? (
                  <WorkspaceLoader label="Authorizing..." />
                ) : (
                  <StreamSetup tabId={activeTabId} onStreamReady={handleStreamReady} />
                )}
              </>
            )}

            {isTabsHydrated && !activeIsSetup && activeIsMockData && (
              <>
                <video
                  ref={handleMockVideoRef}
                  className="background-video"
                  autoPlay
                  loop
                  muted
                  playsInline
                  style={{
                    objectFit: arControls.videoFitMode,
                    backgroundColor: "#e5e9ef",
                    pointerEvents: "none",
                  }}
                >
                  <source src={MOCK_DATA_CONFIG.VIDEO_SOURCE} type="video/mp4" />
                </video>
                {arControls.detectionVisible && (
                  <PoiErrorBoundary>
                    <PoiOverlay
                      vessels={interpolatedVessels}
                      videoTransform={mockDataVideoTransform}
                      videoRef={mockDataVideoRef}
                      videoFitMode={arControls.videoFitMode}
                      metricsMode="mock-data"
                    />
                  </PoiErrorBoundary>
                )}
              </>
            )}

            {isTabsHydrated &&
              !activeIsSetup &&
              !activeIsMockData &&
              !effectiveActiveStream &&
              activeTabId !== FUSION_TAB_ID &&
              "No running streams. Join or create one from the sidebar."}

            {isTabsHydrated &&
              !activeIsSetup &&
              activeTabId === FUSION_TAB_ID &&
              !fusionRunningStream && <WorkspaceLoader label="Starting Fusion stream..." />}

            {isTabsHydrated && !activeIsSetup && !activeIsMockData && effectiveActiveStream && (
              <>
                {!mediaAuthReady && (
                  <WorkspaceLoader
                    label={mediaAuthLoading ? "Authorizing media..." : "Preparing media..."}
                  />
                )}

                {mediaAuthError && (
                  <div className="stream-error">
                    <div className="stream-error__message">
                      {auth.authBridgeError || "Media authentication failed."}
                    </div>
                    <button
                      type="button"
                      className="stream-error__action"
                      onClick={auth.retryAuthBridge}
                    >
                      Retry auth
                    </button>
                  </div>
                )}

                {mediaAuthReady &&
                  cachedStreamIds.map((streamId) => {
                    const stream = streamsById.get(streamId);
                    if (!stream) {
                      return null;
                    }
                    const playbackUrls = stream.playback_urls;
                    const isActivePlayer = streamId === activePlayableStreamId;

                    return (
                      <VideoPlayer
                        key={`cached-player-${streamId}`}
                        streamId={streamId}
                        whepUrl={playbackUrls?.whep_url}
                        hlsUrl={playbackUrls?.hls_url}
                        sessionToken={videoSession}
                        allowHlsFallback={isActivePlayer}
                        className="background-video"
                        style={{
                          objectFit: arControls.videoFitMode,
                          backgroundColor: "#e5e9ef",
                          opacity: isActivePlayer ? 1 : 0,
                          pointerEvents: "none",
                          transition: "opacity 120ms linear",
                        }}
                        onVideoReady={isActivePlayer ? handleActiveVideoReady : undefined}
                        onStatusChange={isActivePlayer ? handleVideoStatusChange : undefined}
                      />
                    );
                  })}

                {mediaAuthReady && showVideoLoader && (
                  <WorkspaceLoader
                    label={
                      !imageLoaded ? "Connecting to video stream..." : "Waiting for detections..."
                    }
                  />
                )}

                {mediaAuthReady && arControls.detectionVisible && (
                  <PoiErrorBoundary>
                    <PoiOverlay
                      vessels={interpolatedVessels}
                      videoTransform={videoTransform}
                      detectionFrame={
                        videoInfo ? { width: videoInfo.width, height: videoInfo.height } : null
                      }
                      metricsMode={activeTabId === FUSION_TAB_ID ? "fusion" : "default"}
                    />
                  </PoiErrorBoundary>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export default function AROverlay(props: AROverlayProps) {
  return (
    <ARControlProvider>
      <AROverlayInner {...props} />
    </ARControlProvider>
  );
}
