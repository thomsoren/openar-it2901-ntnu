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
import { DETECTION_CONFIG, VIDEO_CONFIG } from "../config/video";
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
import { FUSION_PIRBADET_CONFIG } from "../config/video";
import { FusionMockDataView } from "./Fusion";
import type { StreamSummary } from "../types/stream";
import "./Datavision.css";

interface DatavisionProps {
  externalStreamId?: string | null;
  onAuthGateVisibleChange?: (visible: boolean) => void;
}

function DatavisionInner({ externalStreamId, onAuthGateVisibleChange }: DatavisionProps = {}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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
  } = useVideoSessionRecovery({ streamKey: activeTabId, initialSession: activeInitialSession });

  const showingAuthGate = activeIsSetup && !auth.session;
  const activeIsFusionMock = activeTabId === FUSION_MOCK_TAB_ID;
  const activeIsSpecialFusionTab = activeIsFusionMock;
  const fusionFallbackStream = useMemo<StreamSummary>(
    () => ({
      stream_id: FUSION_TAB_ID,
      status: "starting",
      pid: null,
      restart_count: 0,
      source_url: FUSION_PIRBADET_CONFIG.VIDEO_SOURCE,
      playback_urls: {
        whep_url: VIDEO_CONFIG.MEDIAMTX_WHEP_URL(FUSION_TAB_ID),
        hls_url: VIDEO_CONFIG.MEDIAMTX_HLS_URL(FUSION_TAB_ID),
        rtsp_url: `rtsp://localhost:8854/${FUSION_TAB_ID}`,
      },
    }),
    []
  );
  const effectiveActiveStream =
    activeStream ?? (activeTabId === FUSION_TAB_ID ? fusionFallbackStream : null);
  const activePlayableStreamId =
    !activeIsSetup && !activeIsSpecialFusionTab && effectiveActiveStream
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
  const { vessels, videoInfo } = useDetectionsWebSocket({
    url: detectionWsUrl,
    enabled: wsEnabled && !activeIsSpecialFusionTab,
  });
  const overlayVessels = vessels;
  const streamsById = useMemo(() => {
    const map = new Map(runningStreams.map((stream) => [stream.stream_id, stream] as const));
    if (activeTabId === FUSION_TAB_ID && !map.has(FUSION_TAB_ID)) {
      map.set(FUSION_TAB_ID, fusionFallbackStream);
    }
    return map;
  }, [activeTabId, fusionFallbackStream, runningStreams]);

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
    if (
      activeTabId !== FUSION_TAB_ID ||
      runningStreams.some((s) => s.stream_id === FUSION_TAB_ID)
    ) {
      return;
    }

    let cancelled = false;
    const ensureFusionStreamRunning = async () => {
      try {
        await startStream(FUSION_TAB_ID, {
          sourceUrl: FUSION_PIRBADET_CONFIG.VIDEO_SOURCE,
          loop: true,
          allowExisting: true,
        });
        await refreshStreams();
      } catch (err) {
        if (!cancelled) {
          setControlError(toStreamError(err, "Failed to start Fusion stream"));
        }
      }
    };

    void ensureFusionStreamRunning();
    return () => {
      cancelled = true;
    };
  }, [activeTabId, refreshStreams, runningStreams, setControlError]);

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
            {!isTabsHydrated && (
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
                <div className="video-loading-center__label">Restoring workspace...</div>
              </div>
            )}

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
              !activeIsSpecialFusionTab &&
              !effectiveActiveStream &&
              "No running streams. Join or create one from the sidebar."}

            {isTabsHydrated &&
              !activeIsSetup &&
              !activeIsSpecialFusionTab &&
              effectiveActiveStream && (
                <>
                  {cachedStreamIds.map((streamId) => {
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
                        onVideoReady={
                          isActivePlayer
                            ? (videoEl) => {
                                videoRef.current = videoEl;
                                // If this player was already warm and rendering while hidden,
                                // immediately reflect playing state when it becomes active.
                                if (videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                                  const transport = videoEl.srcObject ? "webrtc" : "hls";
                                  handleVideoStatusChange({
                                    transport,
                                    status: "playing",
                                    error: null,
                                  });
                                }
                              }
                            : undefined
                        }
                        onStatusChange={isActivePlayer ? handleVideoStatusChange : undefined}
                      />
                    );
                  })}

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
                        {!imageLoaded
                          ? "Connecting to video stream..."
                          : "Waiting for detections..."}
                      </div>
                    </div>
                  )}

                  {arControls.detectionVisible && (
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

export default function Datavision(props: DatavisionProps) {
  return (
    <ARControlProvider>
      <DatavisionInner {...props} />
    </ARControlProvider>
  );
}
