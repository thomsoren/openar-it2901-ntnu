import { useState, useRef } from "react";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/openbridge.css";
import { ObcTopBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/top-bar/top-bar";
import { ObcBrillianceMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/brilliance-menu/brilliance-menu";
import "./App.css";
import PoiTargetsWrapper from "./components/poi-targets/PoiTargetsWrapper";
import { ObcClock } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/clock/clock";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { useVideoDetections } from "./useVideoDetections";

const handleBrillianceChange = (e: CustomEvent) => {
  document.documentElement.setAttribute("data-obc-theme", e.detail.value);
};

function App() {
  const [showBrillianceMenu, setShowBrillianceMenu] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Load precomputed boat detections from JSON
  // Fix: Pass videoRef with correct type to useVideoDetections
  const { detections, isLoading, error, totalFrames } = useVideoDetections(videoRef as React.RefObject<HTMLVideoElement>);

  const handleDimmingButtonClicked = () => {
    setShowBrillianceMenu((prev) => !prev);
  };


  return (
    <>
      <header>
        <ObcTopBar
          appTitle="React"
          pageName="Demo"
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
      <ObcButton ></ObcButton>
      <main>
        {showBrillianceMenu && (
          <ObcBrillianceMenu
            onPaletteChanged={handleBrillianceChange}
            show-auto-brightness
            className="brilliance"
          />
        )}

        <video
          ref={videoRef}
          autoPlay
          loop
          muted
          className="background-video"
        >
          <source
            src="/Hurtigruten-Front-Camera-Risoyhamn-Harstad-Dec-28-2011-3min-no-audio.mp4"
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
          <div style={{ position: "absolute", top: "60px", left: "20px", color: "white", backgroundColor: "rgba(0,0,0,0.7)", padding: "10px", borderRadius: "5px", zIndex: 20, fontSize: "12px" }}>
            Detections loaded: {totalFrames} frames | Current: {detections.length} boats
          </div>
        )}

        <PoiTargetsWrapper detections={detections} />
      </main>
    </>
  );
}

export default App;
