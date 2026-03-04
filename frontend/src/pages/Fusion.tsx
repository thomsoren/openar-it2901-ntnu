import { useEffect, useRef, useState } from "react";
import PoiOverlay from "../components/poi-overlay/PoiOverlay";
import { ARControlProvider } from "../components/ar-control-panel/ARControlProvider";
import { useARControls } from "../components/ar-control-panel/useARControls";
import { useDetectionsWebSocket } from "../hooks/useDetectionsWebSocket";
import { useVideoTransform } from "../hooks/useVideoTransform";
import { MOCK_DATA_CONFIG, FUSION_PIRBADET_CONFIG } from "../config/video";
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
        // Continue even if timer reset fails.
      } finally {
        if (!cancelled) {
          setDetectionsEnabled(true);
        }
      }
    };

    void resetFusionTimer();

    return () => {
      cancelled = true;
    };
  }, [config.resetUrl]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 200,
      }}
    >
      {/* Video as separate layer (like regular streams) — avoids ObcPoiController slot display issues */}
      <video
        ref={videoRef}
        className="background-video"
        autoPlay
        loop
        muted
        playsInline
        style={{
          objectFit: arControls.videoFitMode === "cover" ? "cover" : "contain",
        }}
      >
        <source src={config.videoSource} type="video/mp4" />
      </video>
      {arControls.detectionVisible && (
        <PoiOverlay
          vessels={vessels}
          videoTransform={videoTransform}
          videoRef={videoRef}
          videoFitMode={arControls.videoFitMode}
        />
      )}
    </div>
  );
}

export function MockDataView() {
  return (
    <FusionView
      config={{
        width: MOCK_DATA_CONFIG.WIDTH,
        height: MOCK_DATA_CONFIG.HEIGHT,
        videoSource: MOCK_DATA_CONFIG.VIDEO_SOURCE,
        wsUrl: MOCK_DATA_CONFIG.WS_URL,
        resetUrl: MOCK_DATA_CONFIG.RESET_URL,
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

export default function Fusion() {
  return (
    <ARControlProvider>
      <MockDataView />
    </ARControlProvider>
  );
}
