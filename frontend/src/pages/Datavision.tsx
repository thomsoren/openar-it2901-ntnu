import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ObcTabRow } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import type { TabData } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import { ObcProgressBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/progress-bar/progress-bar";
import {
  CircularProgressState,
  ProgressBarMode,
  ProgressBarType,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/progress-bar/progress-bar.js";
import PoiOverlay from "../components/poi-overlay/PoiOverlay";
import VideoPlayer, { type VideoPlayerState } from "../components/video-player/VideoPlayer";
import { useDetectionsWebSocket } from "../hooks/useDetectionsWebSocket";
import { useVideoTransform } from "../hooks/useVideoTransform";
import { useSettings } from "../contexts/useSettings";
import { API_CONFIG, DETECTION_CONFIG } from "../config/video";
import "./Datavision.css";

interface StreamSummary {
  stream_id: string;
  status: string;
  pid: number | null;
  restart_count: number;
  source_url: string;
  playback_urls?: {
    whep_url?: string;
    hls_url?: string;
    rtsp_url?: string;
    mjpeg_url?: string;
    media_enabled?: boolean;
  };
}

interface TabSelectedDetail {
  tab: TabData;
  id: string;
  index: number;
}

interface TabClosedDetail {
  tab: TabData;
  id: string;
  index: number;
}

const STREAM_SELECTION_STORAGE_KEY = "openar.selectedStreamId";
const JOINED_STREAMS_STORAGE_KEY = "openar.joinedStreamIds";
const STREAM_SELECTION_EVENT = "openar-stream-select";

const getInitialActiveStreamId = (): string => {
  try {
    const stored = localStorage.getItem(STREAM_SELECTION_STORAGE_KEY);
    return stored?.trim() || "default";
  } catch {
    return "default";
  }
};

const getInitialJoinedStreams = (): string[] => {
  try {
    const raw = localStorage.getItem(JOINED_STREAMS_STORAGE_KEY);
    if (!raw) {
      return ["default"];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return ["default"];
    }
    const normalized = Array.from(
      new Set(parsed.map((value) => String(value).trim()).filter((value) => value.length > 0))
    );
    return normalized.length > 0 ? normalized : ["default"];
  } catch {
    return ["default"];
  }
};

function Datavision() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const firstFrameWatchdogRef = useRef<number | null>(null);
  const firstFrameRetryDoneRef = useRef(false);
  const reconnectCountRef = useRef(0);
  const imageLoadedRef = useRef(false);
  const { videoFitMode, detectionVisible, multiStreamTestingEnabled } = useSettings();
  const [imageLoaded, setImageLoaded] = useState(false);
  const [activeStreamId, setActiveStreamId] = useState(() => getInitialActiveStreamId());
  const [joinedStreamIds, setJoinedStreamIds] = useState<string[]>(() => getInitialJoinedStreams());
  const [controlError, setControlError] = useState<string | null>(null);
  const [runningStreams, setRunningStreams] = useState<StreamSummary[]>([]);
  const [hasLoadedStreamList, setHasLoadedStreamList] = useState(false);
  const [wsEnabled, setWsEnabled] = useState(true);
  const [videoSession, setVideoSession] = useState(0);
  const [videoState, setVideoState] = useState<VideoPlayerState>({
    transport: "webrtc",
    status: "idle",
    error: null,
  });
  const [clockTickMs, setClockTickMs] = useState(() => performance.now());
  const detectionClockRef = useRef<Record<string, { timestampMs: number; perfMs: number }>>({});
  const frameClockRef = useRef<Record<string, { timestampMs: number; perfMs: number }>>({});
  const [videoDisplayMs, setVideoDisplayMs] = useState(0);
  const pendingLatencyRef = useRef<Array<{ sourceTsMs: number; frameSentAtMs: number }>>([]);
  const [lastDisplayLatencyMs, setLastDisplayLatencyMs] = useState<number | null>(null);
  const [displayLatencySamples, setDisplayLatencySamples] = useState<number[]>([]);
  const apiBase = API_CONFIG.BASE_URL.replace(/\/$/, "");
  const MAX_RECONNECT_ATTEMPTS = 8;

  const apiFetch = useCallback(
    (path: string, init?: RequestInit): Promise<Response> => fetch(`${apiBase}${path}`, init),
    [apiBase]
  );

  const readJsonSafely = async (
    response: Response
  ): Promise<{ detail?: string; streams?: StreamSummary[] }> => {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Backend returned non-JSON response. Check API URL/proxy config.");
    }
    return response.json();
  };

  const explainFetchError = (err: unknown, fallback: string): string => {
    if (err instanceof TypeError && err.message === "Failed to fetch") {
      return "Failed to fetch. Verify backend URL, network reachability, and CORS origin allowlist.";
    }
    return err instanceof Error ? err.message : fallback;
  };

  const wsUrl = useMemo(() => DETECTION_CONFIG.WS_URL(activeStreamId), [activeStreamId]);

  // Receive detection updates via WebSocket (runs at YOLO speed ~5 FPS)
  // Video plays independently at native 25 FPS
  const {
    vessels,
    isLoading,
    error,
    isConnected,
    detectionTimestampMs,
    frameTimestampMs,
    frameSentAtMs,
  } = useDetectionsWebSocket({ url: wsUrl, enabled: wsEnabled });

  // Calculate video transform for accurate POI positioning
  const videoTransform = useVideoTransform(
    videoRef,
    containerRef,
    videoFitMode,
    undefined,
    undefined,
    imageLoaded
  );

  const refreshStreams = useCallback(async () => {
    try {
      const response = await apiFetch("/api/streams");
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        throw new Error(payload.detail || "Failed to load streams");
      }
      const streams = Array.isArray(payload.streams) ? payload.streams : [];
      setRunningStreams(streams);
      setHasLoadedStreamList(true);
    } catch (err) {
      setControlError(explainFetchError(err, "Failed to load streams"));
    }
  }, [apiFetch]);

  const clearReconnectTimers = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (firstFrameWatchdogRef.current !== null) {
      window.clearTimeout(firstFrameWatchdogRef.current);
      firstFrameWatchdogRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(
    (reasonLabel: string) => {
      if (reconnectTimerRef.current !== null) {
        return;
      }
      if (reconnectCountRef.current >= MAX_RECONNECT_ATTEMPTS) {
        // All fast retries exhausted — wait 30 s then reset and try again.
        setControlError(`Video stream '${activeStreamId}' unavailable. Retrying in 30s...`);
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          reconnectCountRef.current = 0;
          setVideoSession((prev) => prev + 1);
        }, 30_000);
        return;
      }
      reconnectCountRef.current += 1;
      const delayMs = 250 + reconnectCountRef.current * 250;
      setControlError(
        `${reasonLabel} '${activeStreamId}' (${reconnectCountRef.current}/${MAX_RECONNECT_ATTEMPTS})...`
      );
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        setVideoSession((prev) => prev + 1);
      }, delayMs);
    },
    [MAX_RECONNECT_ATTEMPTS, activeStreamId]
  );

  const generateUniqueStreamId = useCallback(() => {
    const existing = new Set([
      ...runningStreams.map((stream) => stream.stream_id),
      ...joinedStreamIds,
    ]);
    let index = 1;
    let candidate = "stream";
    while (existing.has(candidate)) {
      index += 1;
      candidate = `stream-${index}`;
    }
    return candidate;
  }, [joinedStreamIds, runningStreams]);

  const startStream = useCallback(
    async (streamId: string) => {
      const response = await apiFetch(`/api/streams/${encodeURIComponent(streamId)}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loop: true }),
      });
      const payload = await readJsonSafely(response);
      if (!response.ok && response.status !== 409) {
        throw new Error(payload.detail || "Failed to start stream");
      }
    },
    [apiFetch]
  );

  const stopStream = useCallback(
    async (streamId: string) => {
      const response = await apiFetch(`/api/streams/${encodeURIComponent(streamId)}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404) {
        const payload = await readJsonSafely(response);
        throw new Error(payload.detail || "Failed to stop stream");
      }
    },
    [apiFetch]
  );

  const connectToStream = useCallback(
    (streamId: string) => {
      if (!streamId) {
        setControlError("Stream ID is required");
        return;
      }
      const exists = runningStreams.some((stream) => stream.stream_id === streamId);
      if (!exists) {
        setControlError(
          `Stream '${streamId}' was not found in latest list. Trying to connect anyway.`
        );
      }
      setActiveStreamId(streamId);
      setWsEnabled(true);
      setImageLoaded(false);
    },
    [runningStreams]
  );

  useEffect(() => {
    refreshStreams();
  }, [refreshStreams]);

  useEffect(() => {
    const sendHeartbeats = () => {
      for (const streamId of joinedStreamIds) {
        apiFetch(`/api/streams/${encodeURIComponent(streamId)}/heartbeat`, {
          method: "POST",
        }).catch(() => {});
      }
    };
    sendHeartbeats();
    const interval = window.setInterval(sendHeartbeats, 60_000);
    return () => window.clearInterval(interval);
  }, [joinedStreamIds, apiFetch]);

  // When the browser tab becomes visible again, force a fresh stream connection.
  // Browsers often silently drop streaming connections for background tabs and
  // don't fire onError, so the video can stay frozen without this.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        reconnectCountRef.current = 0;
        firstFrameRetryDoneRef.current = false;
        setVideoSession((prev) => prev + 1);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    reconnectCountRef.current = 0;
    firstFrameRetryDoneRef.current = false;
    setControlError(null);
    pendingLatencyRef.current = [];
    setLastDisplayLatencyMs(null);
    setDisplayLatencySamples([]);
    setVideoDisplayMs(0);
    setVideoState({
      transport: "webrtc",
      status: "idle",
      error: null,
    });
  }, [activeStreamId, videoSession]);

  useEffect(() => {
    imageLoadedRef.current = false;
    clearReconnectTimers();
    firstFrameWatchdogRef.current = window.setTimeout(() => {
      if (imageLoadedRef.current) {
        return;
      }
      if (firstFrameRetryDoneRef.current) {
        return;
      }
      firstFrameRetryDoneRef.current = true;
      scheduleReconnect("Waiting for first video frame from");
    }, 6000);

    return () => {
      clearReconnectTimers();
    };
  }, [activeStreamId, clearReconnectTimers, scheduleReconnect]);

  useEffect(() => {
    return () => {
      clearReconnectTimers();
    };
  }, [clearReconnectTimers]);

  useEffect(() => {
    if (!multiStreamTestingEnabled) {
      return;
    }
    const interval = window.setInterval(() => {
      refreshStreams();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [multiStreamTestingEnabled, refreshStreams]);

  useEffect(() => {
    if (runningStreams.length === 0) {
      return;
    }
    const activeExists = runningStreams.some((stream) => stream.stream_id === activeStreamId);
    if (activeExists) {
      return;
    }
    const defaultExists = runningStreams.some((stream) => stream.stream_id === "default");
    const fallback = defaultExists ? "default" : runningStreams[0]?.stream_id;
    if (!fallback) {
      return;
    }
    setJoinedStreamIds((prev) => (prev.includes(fallback) ? prev : [...prev, fallback]));
    connectToStream(fallback);
  }, [activeStreamId, connectToStream, runningStreams]);

  useEffect(() => {
    if (!hasLoadedStreamList) {
      return;
    }

    const available = new Set(runningStreams.map((stream) => stream.stream_id));
    setJoinedStreamIds((prev) => {
      const next = prev.filter((id) => available.has(id));
      const withDefault = next.length > 0 || !available.has("default") ? next : ["default"];
      const unchanged =
        withDefault.length === prev.length && withDefault.every((id, index) => id === prev[index]);
      return unchanged ? prev : withDefault;
    });
  }, [hasLoadedStreamList, runningStreams]);

  useEffect(() => {
    try {
      localStorage.setItem(STREAM_SELECTION_STORAGE_KEY, activeStreamId);
    } catch {
      // Ignore storage errors.
    }
  }, [activeStreamId]);

  useEffect(() => {
    try {
      localStorage.setItem(JOINED_STREAMS_STORAGE_KEY, JSON.stringify(joinedStreamIds));
    } catch {
      // Ignore storage errors.
    }
  }, [joinedStreamIds]);

  useEffect(() => {
    const onStreamSelected = (event: Event) => {
      const customEvent = event as CustomEvent<{ streamId?: string }>;
      const streamId = customEvent.detail?.streamId?.trim();
      if (!streamId) {
        return;
      }
      setJoinedStreamIds((prev) => {
        if (prev.includes(streamId)) {
          return prev;
        }
        return [...prev, streamId];
      });
      setRunningStreams((prev) => {
        if (prev.some((stream) => stream.stream_id === streamId)) {
          return prev;
        }
        return [
          ...prev,
          {
            stream_id: streamId,
            status: "unknown",
            pid: null,
            restart_count: 0,
            source_url: "",
          },
        ];
      });
      connectToStream(streamId);
      refreshStreams().catch(() => {
        // Keep optimistic tab state even if background sync fails.
      });
    };
    window.addEventListener(STREAM_SELECTION_EVENT, onStreamSelected as EventListener);
    return () => {
      window.removeEventListener(STREAM_SELECTION_EVENT, onStreamSelected as EventListener);
    };
  }, [connectToStream, refreshStreams]);

  const visibleStreams = useMemo(() => {
    const byId = new Map(runningStreams.map((stream) => [stream.stream_id, stream] as const));
    const joined = joinedStreamIds
      .map((id) => byId.get(id))
      .filter((stream): stream is StreamSummary => Boolean(stream))
      .slice(0, 5);

    if (joined.length > 0) {
      return joined;
    }
    const fallbackDefault = byId.get("default");
    return fallbackDefault ? [fallbackDefault] : [];
  }, [joinedStreamIds, runningStreams]);

  const streamTabs = useMemo<TabData[]>(() => {
    if (visibleStreams.length === 0) {
      return [
        { id: activeStreamId || "default", title: activeStreamId || "default", disabled: true },
      ];
    }
    return visibleStreams.map((stream) => ({
      id: stream.stream_id,
      title: stream.stream_id,
    }));
  }, [activeStreamId, visibleStreams]);

  const handleTabSelected = (event: CustomEvent<TabSelectedDetail>) => {
    const streamId = event.detail?.id;
    if (!streamId) {
      return;
    }
    connectToStream(streamId);
  };

  const handleTabClosed = async (event: CustomEvent<TabClosedDetail>) => {
    const streamId = event.detail?.id?.trim();
    if (!streamId) {
      return;
    }
    if (streamId === "default") {
      setControlError("Default stream cannot be closed.");
      return;
    }

    try {
      await stopStream(streamId);
      setJoinedStreamIds((prev) => prev.filter((id) => id !== streamId));
      await refreshStreams();

      if (activeStreamId === streamId) {
        const fallback =
          visibleStreams.find((stream) => stream.stream_id !== streamId)?.stream_id || "default";
        connectToStream(fallback);
      }
    } catch (err) {
      setControlError(explainFetchError(err, "Failed to close stream"));
    }
  };

  const handleAddTab = async () => {
    const streamId = generateUniqueStreamId();
    try {
      await startStream(streamId);
      setJoinedStreamIds((prev) => {
        if (prev.includes(streamId)) {
          return prev;
        }
        return [...prev, streamId];
      });
      await refreshStreams();
      connectToStream(streamId);
    } catch (err) {
      setControlError(explainFetchError(err, "Failed to add stream tab"));
    }
  };

  const activeStream = useMemo(
    () => visibleStreams.find((stream) => stream.stream_id === activeStreamId) ?? null,
    [activeStreamId, visibleStreams]
  );

  const activeStreamPlayback = activeStream?.playback_urls ?? null;
  const detectionsReady = isConnected && !isLoading && !error;
  const showVideoLoader =
    !imageLoaded ||
    !detectionsReady ||
    videoState.status === "connecting" ||
    videoState.status === "stalled";

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClockTickMs(performance.now());
      const videoEl = videoRef.current;
      if (videoEl) {
        const current = Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0;
        setVideoDisplayMs(Math.max(0, current * 1000));
      }
    }, 200);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (detectionTimestampMs <= 0) {
      return;
    }
    detectionClockRef.current[activeStreamId] = {
      timestampMs: detectionTimestampMs,
      perfMs: performance.now(),
    };
  }, [activeStreamId, detectionTimestampMs]);

  useEffect(() => {
    if (frameTimestampMs <= 0 || frameSentAtMs <= 0) {
      return;
    }
    pendingLatencyRef.current.push({
      sourceTsMs: frameTimestampMs,
      frameSentAtMs,
    });
    if (pendingLatencyRef.current.length > 300) {
      pendingLatencyRef.current.splice(0, pendingLatencyRef.current.length - 300);
    }
  }, [frameTimestampMs, frameSentAtMs]);

  useEffect(() => {
    if (frameTimestampMs <= 0) {
      return;
    }
    frameClockRef.current[activeStreamId] = {
      timestampMs: frameTimestampMs,
      perfMs: performance.now(),
    };
  }, [activeStreamId, frameTimestampMs]);

  useEffect(() => {
    const pending = pendingLatencyRef.current;
    if (pending.length === 0) {
      return;
    }
    const effectiveClockMs = videoDisplayMs > 0 ? videoDisplayMs : frameTimestampMs;
    if (effectiveClockMs <= 0) {
      return;
    }

    while (pending.length > 0 && pending[0].sourceTsMs <= effectiveClockMs) {
      const sample = pending.shift();
      if (!sample) {
        break;
      }
      const latencyMs = Math.max(0, Date.now() - sample.frameSentAtMs);
      setLastDisplayLatencyMs(latencyMs);
      setDisplayLatencySamples((prev) => {
        const next = [...prev, latencyMs];
        if (next.length > 200) {
          next.splice(0, next.length - 200);
        }
        return next;
      });
    }
  }, [frameTimestampMs, videoDisplayMs]);

  const detectionClockMs = useMemo(() => {
    const saved = detectionClockRef.current[activeStreamId];
    if (!saved) {
      return Math.max(0, detectionTimestampMs);
    }
    const delta = Math.max(0, clockTickMs - saved.perfMs);
    return Math.max(saved.timestampMs, saved.timestampMs + delta);
  }, [activeStreamId, clockTickMs, detectionTimestampMs]);

  const frameClockMs = useMemo(() => {
    const saved = frameClockRef.current[activeStreamId];
    if (!saved) {
      return Math.max(0, frameTimestampMs);
    }
    const delta = Math.max(0, clockTickMs - saved.perfMs);
    return Math.max(saved.timestampMs, saved.timestampMs + delta);
  }, [activeStreamId, clockTickMs, frameTimestampMs]);

  const videoClockMs = useMemo(() => {
    if (videoDisplayMs > 0) {
      return videoDisplayMs;
    }
    return frameClockMs;
  }, [frameClockMs, videoDisplayMs]);

  // Keep displayed detection time aligned to the displayed video timeline.
  // Detection freshness is shown separately by "(+Xs)".
  const detectionDisplayClockMs = useMemo(() => {
    if (videoClockMs > 0) {
      return videoClockMs;
    }
    return detectionClockMs;
  }, [videoClockMs, detectionClockMs]);

  const secondsSinceLastUpdate = useMemo(() => {
    const saved = detectionClockRef.current[activeStreamId];
    if (!saved) {
      return 0;
    }
    return Math.max(0, (clockTickMs - saved.perfMs) / 1000);
  }, [activeStreamId, clockTickMs]);

  const latencyStats = useMemo(() => {
    if (displayLatencySamples.length === 0) {
      return { p50: null as number | null, p95: null as number | null };
    }
    const sorted = [...displayLatencySamples].sort((a, b) => a - b);
    const percentile = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
    return {
      p50: percentile(0.5),
      p95: percentile(0.95),
    };
  }, [displayLatencySamples]);

  const formatClock = (ms: number) =>
    `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

  const handleVideoStatusChange = useCallback(
    (next: VideoPlayerState) => {
      setVideoState(next);

      if (next.status === "playing") {
        imageLoadedRef.current = true;
        reconnectCountRef.current = 0;
        setImageLoaded(true);
        clearReconnectTimers();
        setControlError((prev) => {
          if (
            prev?.startsWith("Video stream") ||
            prev?.startsWith("Waiting for first video frame") ||
            prev?.startsWith("WebRTC stream") ||
            prev?.startsWith("HLS stream")
          ) {
            return null;
          }
          return prev;
        });
        return;
      }

      if (next.status === "error") {
        imageLoadedRef.current = false;
        setImageLoaded(false);
        scheduleReconnect(
          next.transport === "webrtc" ? "WebRTC stream reconnecting" : "HLS stream reconnecting"
        );
        return;
      }

      // Do not tear down an already visible stream on transient waiting/stalled states.
      // Live streams often emit short stalls while still healthy.
      if (!imageLoadedRef.current) {
        setImageLoaded(false);
      }
    },
    [clearReconnectTimers, scheduleReconnect]
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <section className="stream-workspace">
        <div className="stream-tabs-shell">
          <ObcTabRow
            className="stream-tab-row"
            tabs={streamTabs}
            selectedTabId={activeStreamId}
            hasAddNewTab
            hasClose
            onTabSelected={handleTabSelected}
            onTabClosed={handleTabClosed}
            onAddNewTab={handleAddTab}
          />

          <div
            ref={containerRef}
            className={["stream-card-content", !activeStream ? "stream-card-content--empty" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            {!activeStream && "No running streams. Join or create one from the sidebar."}

            {activeStream && (
              <>
                <VideoPlayer
                  key={`${activeStreamId}-${videoSession}`}
                  streamId={activeStream.stream_id}
                  whepUrl={activeStreamPlayback?.whep_url}
                  hlsUrl={activeStreamPlayback?.hls_url}
                  sessionToken={videoSession}
                  className="background-video"
                  style={{ objectFit: videoFitMode, backgroundColor: "#e5e9ef" }}
                  onVideoReady={(videoEl) => {
                    videoRef.current = videoEl;
                  }}
                  onStatusChange={handleVideoStatusChange}
                />

                {showVideoLoader && (
                  <div className="video-loading-center">
                    <ObcProgressBar
                      className="video-loading-center__progress"
                      type={ProgressBarType.circular}
                      mode={ProgressBarMode.indeterminate}
                      circularState={CircularProgressState.indeterminate}
                      style={
                        {
                          "--instrument-enhanced-secondary-color": "#4ea9dd",
                          "--container-backdrop-color": "rgba(68, 88, 112, 0.22)",
                        } as CSSProperties
                      }
                    >
                      <span slot="icon"></span>
                    </ObcProgressBar>
                    <div className="video-loading-center__label">
                      {!imageLoaded
                        ? "Starting stream — waiting for first frame..."
                        : "Waiting for detections..."}
                    </div>
                  </div>
                )}
                {isLoading && imageLoaded && (
                  <div className="status-overlay">Connecting to detection stream...</div>
                )}
                {error && <div className="status-overlay status-error">Error: {error}</div>}
                {!isLoading && !error && (
                  <div className="status-overlay status-info">
                    {isConnected ? "Connected" : "Disconnected"} | Stream: {activeStreamId} | Video
                    Time: {formatClock(videoClockMs)} | Detection Time:{" "}
                    {formatClock(detectionDisplayClockMs)}{" "}
                    {`(+${secondsSinceLastUpdate.toFixed(1)}s)`} | Video:{" "}
                    {videoState.transport.toUpperCase()} {videoState.status}
                    {lastDisplayLatencyMs !== null
                      ? ` | Display latency: ${Math.round(lastDisplayLatencyMs)}ms${latencyStats.p50 !== null && latencyStats.p95 !== null ? ` (p50 ${Math.round(latencyStats.p50)} / p95 ${Math.round(latencyStats.p95)})` : ""}`
                      : ""}
                    | Vessels: {vessels.length}
                    {videoState.error ? ` | Video error: ${videoState.error}` : ""}
                    {controlError ? ` | Control: ${controlError}` : ""}
                  </div>
                )}

                {detectionVisible && (
                  <PoiOverlay vessels={vessels} videoTransform={videoTransform} />
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export default Datavision;
