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
import { DETECTION_CONFIG } from "../config/video";
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
import "./Datavision.css";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DatavisionProps {
  /** Set by App.tsx when the user picks a stream from the navigation menu. */
  externalStreamId?: string | null;
  onAuthGateVisibleChange?: (visible: boolean) => void;
}

function DatavisionInner({ externalStreamId, onAuthGateVisibleChange }: DatavisionProps = {}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth
  );
  const { state: arControls } = useARControls();
  const auth = useAuth();

  // --- Tab / stream state (extracted hook) ---
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
    refreshStreams,
  } = useStreamTabs({ externalStreamId });

  const { videoSession, imageLoaded, showVideoLoader, setControlError, handleVideoStatusChange } =
    useVideoSessionRecovery({ streamKey: activeTabId });

  const showingAuthGate = activeIsSetup && !auth.session;
  const activeIsFusionMock = activeTabId === FUSION_MOCK_TAB_ID;
  const activeIsSpecialFusionTab = activeIsFusionMock;

  useEffect(() => {
    onAuthGateVisibleChange?.(showingAuthGate);
  }, [showingAuthGate, onAuthGateVisibleChange]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const detectionWsUrl = useMemo(() => DETECTION_CONFIG.WS_URL(activeTabId), [activeTabId]);

  const { vessels, videoInfo } = useDetectionsWebSocket({
    url: detectionWsUrl,
    enabled: wsEnabled && !activeIsSpecialFusionTab,
  });

  const videoTransform = useVideoTransform(
    videoRef,
    containerRef,
    arControls.videoFitMode,
    undefined,
    undefined,
    imageLoaded
  );

  useEffect(() => {
    if (activeTabId !== FUSION_TAB_ID || activeStream) {
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
  }, [activeTabId, activeStream, refreshStreams, setControlError]);

  // --- Tab close with backend DELETE ---
  const onTabClosed = useCallback(
    async (event: CustomEvent<{ id?: string }>) => {
      const tabId = event.detail?.id?.trim();
      if (
        !tabId ||
        tabId === DEFAULT_STREAM_ID ||
        tabId === FUSION_MOCK_TAB_ID ||
        tabId === FUSION_TAB_ID
      )
        return;

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

  const activeStreamPlayback = activeStream?.playback_urls ?? null;

  const tabWidth = 210; // OBC tab row renders uniform tab widths in this layout
  const requiredTabsWidth = tabs.length * tabWidth;
  const controlsPanelWidth = 690; // AR controls + spacing
  const layoutPadding = 140;
  const requiredWidth = requiredTabsWidth + controlsPanelWidth + layoutPadding;
  const shouldStackTabsBar = viewportWidth < requiredWidth;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <section className="stream-workspace">
        <div className="stream-tabs-shell">
          <StreamWorkspaceHeader
            tabs={tabs}
            activeTabId={activeTabId}
            showAddButton={isTabsHydrated && showAddButton}
            showCloseButtons={isTabsHydrated && showCloseButtons}
            shouldStackTabsBar={shouldStackTabsBar}
            onTabSelected={handleTabSelected}
            onTabClosed={onTabClosed}
            onAddTab={handleAddTab}
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
              !activeStream &&
              "No running streams. Join or create one from the sidebar."}

            {isTabsHydrated && !activeIsSetup && !activeIsSpecialFusionTab && activeStream && (
              <>
                <VideoPlayer
                  key={`${activeTabId}-${videoSession}`}
                  streamId={activeStream.stream_id}
                  whepUrl={activeStreamPlayback?.whep_url}
                  hlsUrl={activeStreamPlayback?.hls_url}
                  sessionToken={videoSession}
                  className="background-video"
                  style={{ objectFit: arControls.videoFitMode, backgroundColor: "#e5e9ef" }}
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

                {arControls.detectionVisible && (
                  <PoiErrorBoundary>
                    <PoiOverlay
                      vessels={vessels}
                      videoTransform={videoTransform}
                      detectionFrame={
                        videoInfo ? { width: videoInfo.width, height: videoInfo.height } : null
                      }
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

function Datavision(props: DatavisionProps) {
  return (
    <ARControlProvider>
      <DatavisionInner {...props} />
    </ARControlProvider>
  );
}

export default Datavision;
