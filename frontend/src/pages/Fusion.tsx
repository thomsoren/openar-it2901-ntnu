import { useEffect, useState, useRef } from "react";
import PoiOverlay from "../components/poi-overlay/PoiOverlay";
import { useDetectionsWebSocket } from "../hooks/useDetectionsWebSocket";
import { useVideoTransform } from "../hooks/useVideoTransform";
import { useSettings } from "../contexts/SettingsContext";
import { API_CONFIG, FUSION_VIDEO_CONFIG } from "../config/video";

function Fusion() {
  const [detectionsEnabled, setDetectionsEnabled] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { videoFitMode, detectionVisible } = useSettings();

  // Use WebSocket for real-time fusion detections
  const { vessels, isLoading, error, isConnected, fps } = useDetectionsWebSocket({
    url: `${API_CONFIG.WS_BASE_URL}/api/fusion/ws`,
    config: { track: true, loop: true },
    enabled: detectionsEnabled,
  });

  // Calculate video transform for accurate POI positioning
  const videoTransform = useVideoTransform(
    videoRef,
    containerRef,
    videoFitMode,
    FUSION_VIDEO_CONFIG.WIDTH,
    FUSION_VIDEO_CONFIG.HEIGHT
  );

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
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        className="background-video"
        style={{ objectFit: videoFitMode }}
      >
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

      {detectionVisible && <PoiOverlay vessels={vessels} videoTransform={videoTransform} />}
    </div>
  );
}

export default Fusion;
