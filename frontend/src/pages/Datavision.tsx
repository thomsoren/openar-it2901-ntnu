import { useRef, useState } from "react";
import PoiOverlay from "../components/poi-overlay/PoiOverlay";
import { useDetectionsWebSocket } from "../hooks/useDetectionsWebSocket";
import { useVideoTransform } from "../hooks/useVideoTransform";
import { useSettings } from "../contexts/SettingsContext";
import { VIDEO_CONFIG, DETECTION_CONFIG } from "../config/video";

function Datavision() {
  const videoRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { videoFitMode, detectionVisible } = useSettings();
  const [imageLoaded, setImageLoaded] = useState(false);

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
    VIDEO_CONFIG.HEIGHT,
    imageLoaded
  );

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* MJPEG stream from backend - synced with detections */}
      <img
        ref={videoRef}
        src={VIDEO_CONFIG.SOURCE}
        alt="Video stream"
        className="background-video"
        style={{ objectFit: videoFitMode }}
        onLoad={() => setImageLoaded(true)}
      />

      {/* Status overlay */}
      {isLoading && <div className="status-overlay">Connecting to detection stream...</div>}
      {error && <div className="status-overlay status-error">Error: {error}</div>}
      {!isLoading && !error && (
        <div className="status-overlay status-info">
          {isConnected ? "Connected" : "Disconnected"} | Detection: {(fps ?? 0).toFixed(1)} FPS |
          Vessels: {vessels.length}
        </div>
      )}

      {/* Vessel markers overlay */}
      {detectionVisible && <PoiOverlay vessels={vessels} videoTransform={videoTransform} />}
    </div>
  );
}

export default Datavision;
