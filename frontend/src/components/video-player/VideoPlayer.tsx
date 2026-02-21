import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { VIDEO_CONFIG } from "../../config/video";
import { useWhepConnection } from "../../hooks/useWhepConnection";

type VideoTransport = "webrtc" | "hls";
type VideoConnectionStatus = "idle" | "connecting" | "playing" | "stalled" | "error";

export interface VideoPlayerState {
  transport: VideoTransport;
  status: VideoConnectionStatus;
  error: string | null;
}

export interface VideoPlayerProps {
  streamId: string;
  mediamtxBaseUrl?: string;
  whepUrl?: string;
  hlsUrl?: string;
  onVideoReady?: (video: HTMLVideoElement) => void;
  onStatusChange?: (state: VideoPlayerState) => void;
  className?: string;
  style?: CSSProperties;
  muted?: boolean;
  autoPlay?: boolean;
  playsInline?: boolean;
  sessionToken?: number;
}

const withCacheBust = (url: string, sessionToken: number): string =>
  `${url}${url.includes("?") ? "&" : "?"}v=${sessionToken}`;

function VideoPlayer({
  streamId,
  mediamtxBaseUrl,
  whepUrl,
  hlsUrl,
  onVideoReady,
  onStatusChange,
  className,
  style,
  muted = true,
  autoPlay = true,
  playsInline = true,
  sessionToken = 0,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [transport, setTransport] = useState<VideoTransport>("webrtc");
  const [hlsState, setHlsState] = useState<VideoConnectionStatus>("idle");
  const [hlsError, setHlsError] = useState<string | null>(null);
  const whepRetryCount = useRef(0);

  const resolvedWhepUrl = useMemo(() => {
    if (whepUrl) {
      return whepUrl;
    }
    return VIDEO_CONFIG.MEDIAMTX_WHEP_URL(streamId, mediamtxBaseUrl);
  }, [mediamtxBaseUrl, streamId, whepUrl]);

  const resolvedHlsUrl = useMemo(() => {
    if (hlsUrl) {
      return hlsUrl;
    }
    return VIDEO_CONFIG.MEDIAMTX_HLS_URL(streamId, mediamtxBaseUrl);
  }, [hlsUrl, mediamtxBaseUrl, streamId]);

  useEffect(() => {
    setTransport("webrtc");
    setHlsState("idle");
    setHlsError(null);
  }, [streamId, sessionToken, resolvedWhepUrl, resolvedHlsUrl]);

  useEffect(() => {
    if (videoRef.current && onVideoReady) {
      onVideoReady(videoRef.current);
    }
  }, [onVideoReady]);

  const { status: whepStatus, error: whepError } = useWhepConnection({
    whepUrl: transport === "webrtc" ? resolvedWhepUrl : null,
    videoRef,
    enabled: transport === "webrtc",
    sessionToken,
  });

  useEffect(() => {
    if (transport !== "webrtc") {
      return;
    }
    if (whepStatus !== "error") {
      return;
    }
    if (resolvedHlsUrl) {
      setTransport("hls");
      return;
    }
    onStatusChange?.({
      transport: "webrtc",
      status: "error",
      error: whepError || "WebRTC failed and no HLS fallback URL is available",
    });
  }, [onStatusChange, resolvedHlsUrl, transport, whepError, whepStatus]);

  // Always prefer WebRTC: if we are on HLS fallback, periodically retry WHEP.
  // Stop retrying after 30 attempts to avoid infinite teardown/rebuild of HLS.
  useEffect(() => {
    if (transport !== "hls") {
      whepRetryCount.current = 0;
      return;
    }
    if (!resolvedWhepUrl) {
      return;
    }
    if (whepRetryCount.current >= 30) {
      return;
    }

    const retryTimer = window.setTimeout(() => {
      whepRetryCount.current += 1;
      setTransport("webrtc");
      setHlsState("idle");
      setHlsError(null);
    }, 5000);

    return () => {
      window.clearTimeout(retryTimer);
    };
  }, [resolvedWhepUrl, sessionToken, transport]);

  useEffect(() => {
    if (transport !== "hls") {
      return;
    }

    const videoEl = videoRef.current;
    if (!videoEl) {
      setHlsState("error");
      setHlsError("Video element missing");
      return;
    }
    if (!resolvedHlsUrl) {
      setHlsState("error");
      setHlsError("HLS URL missing");
      return;
    }

    let hls: Hls | null = null;
    const sourceUrl = withCacheBust(resolvedHlsUrl, sessionToken);

    setHlsState("connecting");
    setHlsError(null);

    const onLoadedData = () => setHlsState("playing");
    const onPlaying = () => setHlsState("playing");
    const onWaiting = () => setHlsState("stalled");
    const onStalled = () => setHlsState("stalled");
    const onError = () => {
      setHlsState("error");
      setHlsError("HLS video element error");
    };

    videoEl.addEventListener("loadeddata", onLoadedData);
    videoEl.addEventListener("playing", onPlaying);
    videoEl.addEventListener("waiting", onWaiting);
    videoEl.addEventListener("stalled", onStalled);
    videoEl.addEventListener("error", onError);

    if (Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 30,
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) {
          return;
        }
        setHlsState("error");
        setHlsError(`HLS fatal error: ${data.type}`);
      });
      hls.loadSource(sourceUrl);
      hls.attachMedia(videoEl);
    } else if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
      videoEl.src = sourceUrl;
      videoEl.load();
      void videoEl.play().catch(() => {
        // Autoplay can reject transiently while metadata is pending.
      });
    } else {
      setHlsState("error");
      setHlsError("HLS unsupported in this browser");
    }

    return () => {
      videoEl.removeEventListener("loadeddata", onLoadedData);
      videoEl.removeEventListener("playing", onPlaying);
      videoEl.removeEventListener("waiting", onWaiting);
      videoEl.removeEventListener("stalled", onStalled);
      videoEl.removeEventListener("error", onError);

      if (hls) {
        hls.destroy();
      } else {
        videoEl.removeAttribute("src");
        videoEl.load();
      }
    };
  }, [resolvedHlsUrl, sessionToken, streamId, transport]);

  useEffect(() => {
    if (!onStatusChange) {
      return;
    }
    if (transport === "webrtc") {
      onStatusChange({
        transport,
        status: whepStatus,
        error: whepError,
      });
      return;
    }
    onStatusChange({
      transport,
      status: hlsState,
      error: hlsError,
    });
  }, [hlsError, hlsState, onStatusChange, transport, whepError, whepStatus]);

  return (
    <video
      key={`${streamId}-${sessionToken}-${transport}`}
      ref={videoRef}
      className={className}
      style={style}
      autoPlay={autoPlay}
      muted={muted}
      playsInline={playsInline}
    />
  );
}

export default VideoPlayer;
