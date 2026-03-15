import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { getApiAccessToken, getApiBaseUrl } from "../../lib/api-client";

type VideoConnectionStatus = "idle" | "connecting" | "playing" | "stalled" | "error";

export interface VideoPlayerState {
  transport: "hls";
  status: VideoConnectionStatus;
  error: string | null;
}

export interface VideoPlayerProps {
  streamId: string;
  hlsUrl?: string;
  hlsS3Url?: string;
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

const withAccessToken = (url: string): string => {
  const token = getApiAccessToken();
  if (!token) {
    return url;
  }
  const urlObj = new URL(url, window.location.href);
  urlObj.searchParams.set("access_token", token);
  return urlObj.toString();
};

function VideoPlayer({
  streamId,
  hlsUrl,
  hlsS3Url,
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
  // Track the video element in state so the HLS effect re-runs when
  // the <video> remounts (key change on stream switch).
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const videoCallbackRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoEl(node);
  }, []);
  const [hlsState, setHlsState] = useState<VideoConnectionStatus>("idle");
  const [hlsError, setHlsError] = useState<string | null>(null);

  const resolvedHlsUrl = useMemo(() => {
    if (hlsS3Url) {
      // Direct S3 HLS — presigned .m3u8 served through the API
      const base = getApiBaseUrl();
      return `${base}${hlsS3Url}`;
    }
    if (hlsUrl) {
      return hlsUrl;
    }
    return null;
  }, [hlsS3Url, hlsUrl]);

  // Derive status for missing prerequisites without useEffect setState
  const hlsUrlMissing = !resolvedHlsUrl;

  useEffect(() => {
    if (videoEl && onVideoReady) {
      onVideoReady(videoEl);
    }
  }, [onVideoReady, videoEl]);

  useEffect(() => {
    if (!videoEl || !resolvedHlsUrl) {
      return;
    }

    // Use the ref for DOM operations (ESLint treats useState values as immutable)
    const el = videoRef.current;
    if (!el) {
      return;
    }

    let hls: Hls | null = null;
    const sourceUrl = withCacheBust(withAccessToken(resolvedHlsUrl), sessionToken);

    const onLoadedData = () => setHlsState("playing");
    const onPlaying = () => setHlsState("playing");
    const onWaiting = () => setHlsState("stalled");
    const onStalled = () => setHlsState("stalled");
    const onError = () => {
      setHlsState("error");
      setHlsError("HLS video element error");
    };

    el.addEventListener("loadeddata", onLoadedData);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("stalled", onStalled);
    el.addEventListener("error", onError);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial state before async HLS setup
    setHlsState("connecting");
    setHlsError(null);

    if (Hls.isSupported()) {
      const isS3Hls = !!hlsS3Url;
      hls = new Hls({
        // VOD from S3 doesn't need low-latency mode
        lowLatencyMode: !isS3Hls,
        backBufferLength: 30,
        xhrSetup: isS3Hls
          ? undefined // S3 presigned URLs have auth in query params
          : (xhr) => {
              const token = getApiAccessToken();
              if (token) {
                xhr.setRequestHeader("Authorization", `Bearer ${token}`);
              }
            },
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) {
          return;
        }
        setHlsState("error");
        setHlsError(`HLS fatal error: ${data.type}`);
      });
      hls.loadSource(sourceUrl);
      hls.attachMedia(el);
    } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = sourceUrl;
      el.load();
      void el.play().catch(() => {
        // Autoplay can reject transiently while metadata is pending.
      });
    } else {
      setHlsState("error");
      setHlsError("HLS unsupported in this browser");
    }

    return () => {
      el.removeEventListener("loadeddata", onLoadedData);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("stalled", onStalled);
      el.removeEventListener("error", onError);

      if (hls) {
        hls.destroy();
      } else {
        el.removeAttribute("src");
        el.load();
      }
    };
  }, [hlsS3Url, resolvedHlsUrl, sessionToken, videoEl]);

  const effectiveStatus: VideoConnectionStatus = hlsUrlMissing ? "error" : hlsState;
  const effectiveError = hlsUrlMissing ? "HLS URL missing" : hlsError;

  useEffect(() => {
    if (!onStatusChange) {
      return;
    }
    onStatusChange({
      transport: "hls",
      status: effectiveStatus,
      error: effectiveError,
    });
  }, [effectiveError, effectiveStatus, onStatusChange]);

  return (
    <video
      key={`${streamId}-${sessionToken}`}
      ref={videoCallbackRef}
      className={className}
      style={style}
      autoPlay={autoPlay}
      muted={muted}
      playsInline={playsInline}
    />
  );
}

export default VideoPlayer;
