import { useEffect, useState, useRef } from "react";
import PoiOverlay from "../components/poi-overlay/PoiOverlay";
import { ARControlProvider } from "../components/ar-control-panel/ARControlProvider";
import { useARControls } from "../components/ar-control-panel/useARControls";
import { useDetectionsWebSocket } from "../hooks/useDetectionsWebSocket";
import { useVideoTransform } from "../hooks/useVideoTransform";
import { API_CONFIG, FUSION_VIDEO_CONFIG } from "../config/video";
import { apiFetchPublic } from "../lib/api-client";

function FusionInner() {
  const [detectionsEnabled, setDetectionsEnabled] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { state: arControls } = useARControls();
  // Use WebSocket for real-time fusion detections
  const { vessels, isLoading, error, isConnected, fps } = useDetectionsWebSocket({
    url: `${API_CONFIG.WS_BASE_URL}/api/fusion/ws`,
    enabled: detectionsEnabled,
  });

  // Calculate video transform for accurate POI positioning
  const videoTransform = useVideoTransform(
    videoRef,
    containerRef,
    arControls.videoFitMode,
    FUSION_VIDEO_CONFIG.WIDTH,
    FUSION_VIDEO_CONFIG.HEIGHT
  );

  useEffect(() => {
    let cancelled = false;

    const resetFusionTimer = async () => {
      try {
        await apiFetchPublic(`${API_CONFIG.BASE_URL}/api/fusion/reset`, { method: "POST" });
      } catch {
        // Reset failed — continue anyway
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
        playsInline
        className="background-video"
        style={{ objectFit: arControls.videoFitMode }}
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

      {arControls.detectionVisible && (
        <PoiOverlay vessels={vessels} videoTransform={videoTransform} />
      )}
    </div>
  );
}

function Fusion() {
  return (
    <ARControlProvider>
      <FusionInner />
    </ARControlProvider>
  );
}

export default Fusion;
