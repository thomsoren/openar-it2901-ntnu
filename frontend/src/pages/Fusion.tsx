import { useEffect } from "react";
import PoiOverlay from "../components/poi-overlay/PoiOverlay";
import { useDetectionsWebSocket } from "../hooks/useDetectionsWebSocket";
import { API_CONFIG, DETECTION_CONFIG, FUSION_VIDEO_CONFIG } from "../config/video";

function Fusion() {
  // Use dedicated fusion WebSocket endpoint
  const fusionWsUrl = DETECTION_CONFIG.WS_URL.replace("/detections/ws", "/fusion/ws");
  const { vessels, error, isConnected } = useDetectionsWebSocket({
    url: fusionWsUrl,
    config: {}, // Fusion endpoint doesn't need config
  });

  useEffect(() => {
    const resetFusionTimer = async () => {
      try {
        await fetch(`${API_CONFIG.BASE_URL}/api/fusion/reset`, { method: "POST" });
      } catch (err) {
        console.warn("Failed to reset fusion timer", err);
      }
    };

    resetFusionTimer();
  }, []);

  return (
    <>
      <video autoPlay loop muted className="background-video">
        <source src={FUSION_VIDEO_CONFIG.SOURCE} type="video/mp4" />
      </video>

      {!isConnected && <div className="status-overlay">Connecting to fusion stream...</div>}
      {error && <div className="status-overlay status-error">Error: {error}</div>}
      {isConnected && !error && (
        <div className="status-overlay status-info">
          FVessel | Fusion | Vessels: {vessels.length}
        </div>
      )}

      <PoiOverlay
        vessels={vessels}
        width={FUSION_VIDEO_CONFIG.WIDTH}
        height={FUSION_VIDEO_CONFIG.HEIGHT}
      />
    </>
  );
}

export default Fusion;
