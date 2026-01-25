import { useEffect, useState } from "react";
import PoiOverlay from "../components/poi-overlay/PoiOverlay";
import { useDetectionsWebSocket } from "../hooks/useDetectionsWebSocket";
import { API_CONFIG, FUSION_VIDEO_CONFIG } from "../config/video";

function Fusion() {
  const [detectionsEnabled, setDetectionsEnabled] = useState(false);

  // Use WebSocket for real-time fusion detections
  const { vessels, isLoading, error, isConnected, fps } = useDetectionsWebSocket({
    url: `${API_CONFIG.WS_BASE_URL}/api/fusion/ws`,
    config: { track: true, loop: true },
    enabled: detectionsEnabled,
  });

  useEffect(() => {
    let cancelled = false;

    const resetFusionTimer = async () => {
      try {
        await fetch(`${API_CONFIG.BASE_URL}/api/fusion/reset`, { method: "POST" });
      } catch (err) {
        console.warn("Failed to reset fusion timer", err);
      } finally {
        if (!cancelled) {
          setDetectionsEnabled(true);
        }
      }
    };

    resetFusionTimer();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <video autoPlay loop muted className="background-video">
        <source src={FUSION_VIDEO_CONFIG.SOURCE} type="video/mp4" />
      </video>

      {isLoading && <div className="status-overlay">Loading FVessel demo...</div>}
      {error && <div className="status-overlay status-error">Error: {error}</div>}
      {!isLoading && !error && (
        <div className="status-overlay status-info">
          {isConnected ? "Connected" : "Disconnected"} | FVessel | Fusion | {fps.toFixed(1)} FPS |
          Vessels: {vessels.length}
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
