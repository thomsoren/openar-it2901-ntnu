import { useState } from "react";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/openbridge.css";
import { ObcTopBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/top-bar/top-bar";
import { ObcBrillianceMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/brilliance-menu/brilliance-menu";
import { ObcClock } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/clock/clock";
import "./App.css";
import PoiOverlay from "./components/poi-overlay/PoiOverlay";
import { useDetections } from "./hooks/useDetections";
import { VIDEO_CONFIG, DETECTION_CONFIG } from "./config/video";

const handleBrillianceChange = (e: CustomEvent) => {
  document.documentElement.setAttribute("data-obc-theme", e.detail.value);
};

function App() {
  const [showBrillianceMenu, setShowBrillianceMenu] = useState(false);

  // Fetch detected vessels from API
  const { vessels, isLoading, error } = useDetections({
    url: DETECTION_CONFIG.URL,
    pollInterval: DETECTION_CONFIG.POLL_INTERVAL,
  });

  const handleDimmingButtonClicked = () => {
    setShowBrillianceMenu((prev) => !prev);
  };

  return (
    <>
      <header>
        <ObcTopBar
          appTitle="OpenAR"
          pageName="Detection"
          showDimmingButton
          showAppsButton
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
      <main>
        {showBrillianceMenu && (
          <ObcBrillianceMenu
            onPaletteChanged={handleBrillianceChange}
            show-auto-brightness
            className="brilliance"
          />
        )}

        <video autoPlay loop muted className="background-video">
          <source src={VIDEO_CONFIG.SOURCE} type="video/mp4" />
          Your browser does not support the video tag.
        </video>

        {/* Status overlay */}
        {isLoading && (
          <div className="status-overlay">Loading detections...</div>
        )}
        {error && <div className="status-overlay status-error">Error: {error}</div>}
        {!isLoading && !error && (
          <div className="status-overlay status-info">
            Vessels detected: {vessels.length}
          </div>
        )}

        {/* Vessel markers */}
        <PoiOverlay vessels={vessels} />
      </main>
    </>
  );
}

export default App;
