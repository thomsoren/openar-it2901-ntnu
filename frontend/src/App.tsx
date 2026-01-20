import { useState } from "react";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/openbridge.css";
import { ObcTopBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/top-bar/top-bar";
import { ObcBrillianceMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/brilliance-menu/brilliance-menu";
import { ObcClock } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/clock/clock";
import { ObcNavigationMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-menu/navigation-menu";
import { ObcNavigationItem } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-item/navigation-item";
import "./App.css";
import PoiOverlay from "./components/poi-overlay/PoiOverlay";
import Settings from "./pages/Settings";
import { useStreamingDetections } from "./hooks/useStreamingDetections";
import { VIDEO_CONFIG } from "./config/video";

const handleBrillianceChange = (e: CustomEvent) => {
  document.documentElement.setAttribute("data-obc-theme", e.detail.value);
};

function App() {
  const [showBrillianceMenu, setShowBrillianceMenu] = useState(false);
  const [showNavigationMenu, setShowNavigationMenu] = useState(false);
  const [currentPage, setCurrentPage] = useState<"demo" | "settings">("demo");
  // Stream detections synced to MJPEG feed
  const { detections, isStreaming, error, lastFrame, lastTimestamp, fpsEstimate } = useStreamingDetections();

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

      <main>
        {showBrillianceMenu && (
          <ObcBrillianceMenu
            onPaletteChanged={handleBrillianceChange}
            show-auto-brightness
            className="brilliance"
          />
        )}

        {currentPage === "demo" ? (
          <>
            <img
              src={VIDEO_CONFIG.MJPEG_SOURCE}
              alt="Live stream"
              className="background-video"
            />

            {/* Show loading/error status */}
            {!isStreaming && !error && (
              <div style={{ position: "absolute", top: "60px", left: "20px", color: "white", backgroundColor: "rgba(0,0,0,0.7)", padding: "10px", borderRadius: "5px", zIndex: 20 }}>
                Connecting to detections stream...
              </div>
            )}
            {error && (
              <div style={{ position: "absolute", top: "60px", left: "20px", color: "white", backgroundColor: "rgba(255,0,0,0.8)", padding: "10px", borderRadius: "5px", zIndex: 20 }}>
                Error: {error}
              </div>
            )}
            {!error && (
              <div style={{ position: "absolute", top: "60px", left: "20px", color: "white", backgroundColor: "rgba(0,0,0,0.7)", padding: "10px", borderRadius: "5px", zIndex: 20, fontSize: "12px", maxWidth: "420px", lineHeight: "1.4" }}>
                <div>Detections stream: {isStreaming ? "connected" : "disconnected"} | Current: {detections.length} boats</div>
                <div>Last frame: {lastFrame ?? "-"} @ {lastTimestamp?.toFixed(2) ?? "-"}s</div>
                <div>Video mode: stream</div>
                <div>FPS estimate: {fpsEstimate?.toFixed(2) ?? "-"}</div>
              </div>
            )}

            <PoiOverlay detections={detections} />
          </>
        ) : (
          <Settings />
        )}
      </main>
    </>
  );
}

export default App;
