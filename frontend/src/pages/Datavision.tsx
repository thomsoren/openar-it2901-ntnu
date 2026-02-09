import { useRef } from "react";
import PoiOverlay from "../components/poi-overlay/PoiOverlay";
import { useDetectionsWebSocket } from "../hooks/useDetectionsWebSocket";
import { useVideoTransform } from "../hooks/useVideoTransform";
import { useSettings } from "../contexts/SettingsContext";
import { VIDEO_CONFIG, DETECTION_CONFIG } from "../config/video";

function Datavision() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { videoFitMode, detectionVisible } = useSettings();

  // Receive detection updates via WebSocket (runs at YOLO speed ~5 FPS)
  // Video plays independently at native 25 FPS
  const { vessels, isLoading, error, isConnected, fps } = useDetectionsWebSocket({
    url: DETECTION_CONFIG.WS_URL,
    config: { track: true, loop: true },
  });

  // Calculate video transform for accurate POI positioning
  const videoTransform = useVideoTransform(
    videoRef,
    containerRef,
    videoFitMode,
    VIDEO_CONFIG.WIDTH,
    VIDEO_CONFIG.HEIGHT
  );

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* Native video playback at 25 FPS */}
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        className="background-video"
        style={{ objectFit: videoFitMode }}
      >
        <source src={VIDEO_CONFIG.SOURCE} type="video/mp4" />
      </video>

      {/* Status overlay */}
      {isLoading && <div className="status-overlay">Connecting to detection stream...</div>}
      {error && <div className="status-overlay status-error">Error: {error}</div>}
      {!isLoading && !error && (
        <div className="status-overlay status-info">
          {isConnected ? "Connected" : "Disconnected"} | Detection: {fps.toFixed(1)} FPS | Vessels:{" "}
          {vessels.length}
        </div>
      )}

      {/* Vessel markers overlay */}
      {detectionVisible && <PoiOverlay vessels={vessels} videoTransform={videoTransform} />}
    </div>
  );
}

export default Datavision;
