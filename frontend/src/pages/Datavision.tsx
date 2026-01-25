import PoiOverlay from "../components/poi-overlay/PoiOverlay";
import { useDetectionsWebSocket } from "../hooks/useDetectionsWebSocket";
import { VIDEO_CONFIG, DETECTION_CONFIG } from "../config/video";

function Datavision() {
  // Receive detection updates via WebSocket - streams precomputed detections from S3
  // Video plays independently at native 25 FPS
  const { vessels, isLoading, error, isConnected, fps } = useDetectionsWebSocket({
    url: DETECTION_CONFIG.WS_URL,
    config: { mode: "file", track: true, loop: true },
  });

  return (
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
          {isConnected ? "Connected" : "Disconnected"} | Detection: {fps.toFixed(1)} FPS | Vessels:{" "}
          {vessels.length}
        </div>
      )}

      {/* Vessel markers overlay */}
      <PoiOverlay vessels={vessels} />
    </>
  );
}

export default Datavision;
