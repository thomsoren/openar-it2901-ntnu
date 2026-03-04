import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ObcProgressBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/progress-bar/progress-bar";
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
import { useARControls } from "../components/ar-control-panel/useARControls";
import { useAuth } from "../hooks/useAuth";
import { DETECTION_CONFIG, FUSION_PIRBADET_CONFIG } from "../config/video";
import AuthGate from "../components/auth/AuthGate";
import StreamSetup from "../components/stream-setup/StreamSetup";
import { startStream, stopStream, toStreamError } from "../services/streams";
import { useVideoSessionRecovery } from "../hooks/useVideoSessionRecovery";
import { StreamWorkspaceHeader } from "../components/app/StreamWorkspaceHeader";
import {
  DEFAULT_STREAM_ID,
  FUSION_MOCK_TAB_ID,
  FUSION_TAB_ID,
} from "../hooks/stream-tabs/constants";
import { FusionMockDataView } from "./Fusion";
import "./AROverlay.css";

const LOADER_STUCK_RECOVERY_MS = 12000;
const PLAYER_RECOVERY_COOLDOWN_MS = 15000;
const DETECTION_STALE_RECOVERY_MS = 10000;
const DETECTION_RECOVERY_COOLDOWN_MS = 8000;
const LOADER_PROGRESS_STYLE = {
  "--instrument-enhanced-secondary-color": "#4ea9dd",
  "--container-backdrop-color": "rgba(68, 88, 112, 0.22)",
} as CSSProperties;

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
        style={LOADER_PROGRESS_STYLE}
      >
        <span slot="icon"></span>
      </ObcProgressBar>
      <div className="video-loading-center__label">{label}</div>
    </div>
  );
}

function AROverlayInner({ externalStreamId, onAuthGateVisibleChange }: AROverlayProps = {}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fusionStartInFlightRef = useRef(false);
  const fusionStartLastAttemptMsRef = useRef(0);
  const playerRecoveryLastAtRef = useRef(0);
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
  const [sessionTokensByStream, setSessionTokensByStream] = useState<Record<string, number>>({});
  const activeInitialSession = sessionTokensByStream[activeTabId] ?? 0;

  const {
    recoveryStreamKey,
    videoSession,
    imageLoaded,
    showVideoLoader,
    setControlError,
    handleVideoStatusChange,
    forceReconnect,
  } = useVideoSessionRecovery({ streamKey: activeTabId, initialSession: activeInitialSession });

  const showingAuthGate = activeIsSetup && !auth.session;
  const mediaAuthLoading = Boolean(auth.session) && auth.authBridgeStatus === "loading";
  const mediaAuthError = Boolean(auth.session) && auth.authBridgeStatus === "error";
  const mediaAuthReady = !auth.session || auth.authBridgeStatus === "ready";
  const activeIsFusionMock = activeTabId === FUSION_MOCK_TAB_ID;
  const fusionRunningStream = useMemo(
    () => runningStreams.find((stream) => stream.stream_id === FUSION_TAB_ID) ?? null,
    [runningStreams]
  );
  const effectiveActiveStream = activeTabId === FUSION_TAB_ID ? fusionRunningStream : activeStream;
  const activePlayableStreamId =
    !activeIsSetup && !activeIsFusionMock && effectiveActiveStream
      ? effectiveActiveStream.stream_id
      : null;

  useEffect(() => {
    onAuthGateVisibleChange?.(showingAuthGate);
  }, [showingAuthGate, onAuthGateVisibleChange]);

  useEffect(() => {
    if (!activePlayableStreamId) {
      return;
    }
    setSessionTokensByStream((previous) => {
      if (previous[activePlayableStreamId] === videoSession) {
        return previous;
      }
      return { ...previous, [activePlayableStreamId]: videoSession };
    });
  }, [activePlayableStreamId, videoSession]);

  const detectionWsUrl = useMemo(() => DETECTION_CONFIG.WS_URL(activeTabId), [activeTabId]);
  const { vessels, videoInfo, lastMessageAtMs, connect, disconnect } = useDetectionsWebSocket({
    url: detectionWsUrl,
    enabled:
      wsEnabled &&
      !activeIsFusionMock &&
      (activeTabId !== FUSION_TAB_ID || Boolean(fusionRunningStream)),
  });
  const overlayVessels = vessels;
  const streamsById = useMemo(
    () => new Map(runningStreams.map((stream) => [stream.stream_id, stream] as const)),
    [runningStreams]
  );

  const handleActiveVideoReady = useCallback((videoEl: HTMLVideoElement) => {
    videoRef.current = videoEl;
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

  const getSessionTokenForStream = useCallback(
    (streamId: string): number => {
      const perStreamToken = sessionTokensByStream[streamId];
      if (streamId === activePlayableStreamId) {
        if (recoveryStreamKey === activeTabId) {
          return videoSession;
        }
        return perStreamToken ?? 0;
      }
      return perStreamToken ?? 0;
    },
    [activePlayableStreamId, activeTabId, recoveryStreamKey, sessionTokensByStream, videoSession]
  );

  const videoTransform = useVideoTransform(
    videoRef,
    containerRef,
    arControls.videoFitMode,
    undefined,
    undefined,
    imageLoaded
  );

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
          sourceUrl: FUSION_PIRBADET_CONFIG.VIDEO_SOURCE,
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

  useEffect(() => {
    if (
      !isTabsHydrated ||
      activeIsSetup ||
      activeIsFusionMock ||
      !mediaAuthReady ||
      !effectiveActiveStream ||
      !showVideoLoader
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      const now = Date.now();
      if (now - playerRecoveryLastAtRef.current < PLAYER_RECOVERY_COOLDOWN_MS) {
        return;
      }
      playerRecoveryLastAtRef.current = now;
      forceReconnect("Recovering stream...");

      if (activeTabId === FUSION_TAB_ID) {
        void startStream(FUSION_TAB_ID, {
          sourceUrl: FUSION_PIRBADET_CONFIG.VIDEO_SOURCE,
          loop: true,
          allowExisting: true,
        })
          .catch((err) => {
            setControlError(toStreamError(err, "Failed to recover Fusion stream"));
          })
          .finally(() => {
            void refreshStreams();
          });
        return;
      }

      void refreshStreams();
    }, LOADER_STUCK_RECOVERY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    activeIsSetup,
    activeIsFusionMock,
    activeTabId,
    effectiveActiveStream,
    forceReconnect,
    isTabsHydrated,
    mediaAuthReady,
    refreshStreams,
    setControlError,
    showVideoLoader,
  ]);

  useEffect(() => {
    if (
      !isTabsHydrated ||
      activeIsSetup ||
      activeIsFusionMock ||
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
    activeIsFusionMock,
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
        tabId === FUSION_MOCK_TAB_ID ||
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
            onTabSelected={handleTabSelected}
            onTabClosed={onTabClosed}
            onAddTab={handleAddTab}
          />

          <div
            ref={containerRef}
            className={[
              "stream-card-content",
              activeIsSetup ? "" : !effectiveActiveStream ? "stream-card-content--empty" : "",
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
                ) : (
                  <StreamSetup tabId={activeTabId} onStreamReady={handleStreamReady} />
                )}
              </>
            )}

            {isTabsHydrated && !activeIsSetup && activeIsFusionMock && <FusionMockDataView />}

            {isTabsHydrated &&
              !activeIsSetup &&
              !activeIsFusionMock &&
              !effectiveActiveStream &&
              activeTabId !== FUSION_TAB_ID &&
              "No running streams. Join or create one from the sidebar."}

            {isTabsHydrated &&
              !activeIsSetup &&
              activeTabId === FUSION_TAB_ID &&
              !fusionRunningStream && <WorkspaceLoader label="Starting Fusion stream..." />}

            {isTabsHydrated && !activeIsSetup && !activeIsFusionMock && effectiveActiveStream && (
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
                        sessionToken={getSessionTokenForStream(streamId)}
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
                      vessels={overlayVessels}
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
