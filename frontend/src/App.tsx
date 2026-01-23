import { useState, useRef, useEffect } from "react";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/openbridge.css";
import { ObcTopBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/top-bar/top-bar";
import { ObcBrillianceMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/brilliance-menu/brilliance-menu";
import { ObcClock } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/clock/clock";
import { ObcNavigationMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-menu/navigation-menu";
import { ObcNavigationItem } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-item/navigation-item";
import "./App.css";
import PoiOverlay from "./components/poi-overlay/PoiOverlay";
import Settings from "./pages/Settings";
import { usePrecomputedDetections } from "./hooks/usePrecomputedDetections";
import { useVideoTransform } from "./hooks/useVideoTransform";
import { useSettings } from "./contexts/SettingsContext";
import { VIDEO_CONFIG } from "./config/video";

const handleBrillianceChange = (e: CustomEvent) => {
  document.documentElement.setAttribute("data-obc-theme", e.detail.value);
};

function App() {
  const [showBrillianceMenu, setShowBrillianceMenu] = useState(false);
  const [showNavigationMenu, setShowNavigationMenu] = useState(false);
  const [currentPage, setCurrentPage] = useState<"demo" | "settings">("demo");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { videoFitMode, detectionVisible } = useSettings();

  // Load precomputed boat detections from JSON
  const { detections, isLoading, error, totalFrames, fpsEstimate } = usePrecomputedDetections(videoRef);
  const [bufferedAheadFrames, setBufferedAheadFrames] = useState(0);
  const [bufferedAheadSeconds, setBufferedAheadSeconds] = useState(0);

  // Calculate video transform for accurate POI positioning
  const videoTransform = useVideoTransform(videoRef, containerRef, videoFitMode);

  const handleDimmingButtonClicked = () => {
    setShowBrillianceMenu((prev) => !prev);
  };

  const handleMenuButtonClicked = () => {
    setShowNavigationMenu((prev) => !prev);
  };

  const handleNavigationItemClick = (page: "demo" | "settings") => {
    setCurrentPage(page);
    setShowNavigationMenu(false);
  };

  // Track video buffer for performance monitoring
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState === 0) {
        return;
      }

      let aheadSeconds = 0;
      for (let i = 0; i < video.buffered.length; i += 1) {
        const start = video.buffered.start(i);
        const end = video.buffered.end(i);
        if (video.currentTime >= start && video.currentTime <= end) {
          aheadSeconds = Math.max(0, end - video.currentTime);
          break;
        }
      }

      const fps = fpsEstimate ?? 30;
      setBufferedAheadSeconds(aheadSeconds);
      setBufferedAheadFrames(Math.floor(aheadSeconds * fps));
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [fpsEstimate]);

  return (
    <>
      <header>
        <ObcTopBar
          appTitle="OpenAR"
          pageName={currentPage === "demo" ? "Demo" : "Settings"}
          showDimmingButton
          showAppsButton
          menuButtonActivated={showNavigationMenu}
          onMenuButtonClicked={handleMenuButtonClicked}
          onDimmingButtonClicked={handleDimmingButtonClicked}
        >
          <ObcClock
            date={new Date().toISOString()}
            timeZoneOffsetHours={new Date().getTimezoneOffset() / -60}
            showTimezone
            blinkOnlyBreakpointPx={600}
          />
        </ObcTopBar>
      </header>

      {showNavigationMenu && (
        <ObcNavigationMenu className="navigation-menu">
          <div slot="main">
            <ObcNavigationItem
              label="Demo"
              checked={currentPage === "demo"}
              onClick={() => handleNavigationItemClick("demo")}
            />
            <ObcNavigationItem
              label="Settings"
              checked={currentPage === "settings"}
              onClick={() => handleNavigationItemClick("settings")}
            />
          </div>
        </ObcNavigationMenu>
      )}

      <main ref={containerRef}>
        {showBrillianceMenu && (
          <ObcBrillianceMenu
            onPaletteChanged={handleBrillianceChange}
            show-auto-brightness
            className="brilliance"
          />
        )}

        {currentPage === "demo" ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              loop
              muted
              className="background-video"
              style={{ objectFit: videoFitMode }}
            >
              <source
                src={VIDEO_CONFIG.SOURCE}
                type="video/mp4"
              />
              Your browser does not support the video tag.
            </video>

            {/* Show loading/error status */}
            {isLoading && (
              <div style={{ position: "absolute", top: "60px", left: "20px", color: "white", backgroundColor: "rgba(0,0,0,0.7)", padding: "10px", borderRadius: "5px", zIndex: 20 }}>
                Loading detections...
              </div>
            )}
            {error && (
              <div style={{ position: "absolute", top: "60px", left: "20px", color: "white", backgroundColor: "rgba(255,0,0,0.8)", padding: "10px", borderRadius: "5px", zIndex: 20 }}>
                Error: {error}
              </div>
            )}
            {!isLoading && !error && totalFrames > 0 && (
              <div style={{ position: "absolute", top: "60px", left: "20px", color: "white", backgroundColor: "rgba(0,0,0,0.7)", padding: "10px", borderRadius: "5px", zIndex: 20, fontSize: "12px", maxWidth: "420px", lineHeight: "1.4" }}>
                <div>Detections loaded: {totalFrames} frames | Current: {detections.length} boats</div>
                <div>Video mode: stream</div>
                <div>Buffered ahead: {bufferedAheadFrames} frames ({bufferedAheadSeconds.toFixed(2)}s)</div>
              </div>
            )}

            {detectionVisible && (
              <PoiOverlay detections={detections} videoTransform={videoTransform} />
            )}
          </>
        ) : (
          <Settings />
        )}
      </main>
    </>
  );
}

export default App;
