import { useEffect, useState, useRef } from "react";
import PoiOverlay from "../components/poi-overlay/PoiOverlay";
import { ARControlProvider } from "../components/ar-control-panel/ARControlProvider";
import { useARControls } from "../components/ar-control-panel/useARControls";
import { useDetectionsWebSocket } from "../hooks/useDetectionsWebSocket";
import { useVideoTransform } from "../hooks/useVideoTransform";
import { FUSION_MOCK_CONFIG, FUSION_PIRBADET_CONFIG } from "../config/video";
import { apiFetchPublic } from "../lib/api-client";

interface FusionViewConfig {
  width: number;
  height: number;
  videoSource: string;
  wsUrl: string;
  resetUrl: string;
}

function FusionView({ config }: { config: FusionViewConfig }) {
  const [detectionsEnabled, setDetectionsEnabled] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { state: arControls } = useARControls();
  const { vessels } = useDetectionsWebSocket({
    url: config.wsUrl,
    enabled: detectionsEnabled,
  });

  // Calculate video transform for accurate POI positioning
  const videoTransform = useVideoTransform(
    videoRef,
    containerRef,
    arControls.videoFitMode,
    config.width,
    config.height,
    arControls.detectionVisible
  );

  useEffect(() => {
    let cancelled = false;

    const resetFusionTimer = async () => {
      try {
        await apiFetchPublic(config.resetUrl, { method: "POST" });
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
  }, [config.resetUrl]);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      {arControls.detectionVisible && (
        <PoiOverlay
          vessels={vessels}
          videoTransform={videoTransform}
          videoRef={videoRef}
          videoSource={config.videoSource}
          videoFitMode={arControls.videoFitMode}
        />
      )}
    </div>
  );
}

export function FusionMockDataView() {
  return (
    <FusionView
      config={{
        width: FUSION_MOCK_CONFIG.WIDTH,
        height: FUSION_MOCK_CONFIG.HEIGHT,
        videoSource: FUSION_MOCK_CONFIG.VIDEO_SOURCE,
        wsUrl: FUSION_MOCK_CONFIG.WS_URL,
        resetUrl: FUSION_MOCK_CONFIG.RESET_URL,
      }}
    />
  );
}

export function FusionPirbadetView() {
  return (
    <FusionView
      config={{
        width: FUSION_PIRBADET_CONFIG.WIDTH,
        height: FUSION_PIRBADET_CONFIG.HEIGHT,
        videoSource: FUSION_PIRBADET_CONFIG.VIDEO_SOURCE,
        wsUrl: FUSION_PIRBADET_CONFIG.WS_URL,
        resetUrl: FUSION_PIRBADET_CONFIG.RESET_URL,
      }}
    />
  );
}

function Fusion() {
  return (
    <ARControlProvider>
      <FusionMockDataView />
    </ARControlProvider>
  );
}

export default Fusion;
