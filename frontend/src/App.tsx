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
import { useDetectionsWebSocket } from "./hooks/useDetectionsWebSocket";
import { VIDEO_CONFIG, DETECTION_CONFIG } from "./config/video";

const handleBrillianceChange = (e: CustomEvent) => {
  document.documentElement.setAttribute("data-obc-theme", e.detail.value);
};

function App() {
  const [showBrillianceMenu, setShowBrillianceMenu] = useState(false);
  const [showNavigationMenu, setShowNavigationMenu] = useState(false);
  const [currentPage, setCurrentPage] = useState<"demo" | "settings">("demo");

  // Receive detection updates via WebSocket (runs at YOLO speed ~5 FPS)
  // Video plays independently at native 25 FPS
  const { vessels, isLoading, error, isConnected, fps } = useDetectionsWebSocket({
    url: DETECTION_CONFIG.WS_URL,
    config: { track: true, loop: true },
  });

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
            {/* Native video playback at 25 FPS */}
            <video autoPlay loop muted className="background-video">
              <source src={VIDEO_CONFIG.SOURCE} type="video/mp4" />
            </video>

            {/* Status overlay */}
            {isLoading && <div className="status-overlay">Connecting to detection stream...</div>}
            {error && <div className="status-overlay status-error">Error: {error}</div>}
            {!isLoading && !error && (
              <div className="status-overlay status-info">
                {isConnected ? "Connected" : "Disconnected"} | Detection: {fps.toFixed(1)} FPS |
                Vessels: {vessels.length}
              </div>
            )}

            {/* Vessel markers overlay */}
            <PoiOverlay vessels={vessels} />
          </>
        ) : (
          <Settings />
        )}
      </main>
    </>
  );
}

export default App;
