import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ObcTabRow } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import type { TabData } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import PoiOverlay from "../components/poi-overlay/PoiOverlay";
import { useDetectionsWebSocket } from "../hooks/useDetectionsWebSocket";
import { useVideoTransform } from "../hooks/useVideoTransform";
import { useSettings } from "../contexts/useSettings";
import { API_CONFIG, VIDEO_CONFIG, DETECTION_CONFIG } from "../config/video";
import "./Datavision.css";

interface StreamSummary {
  stream_id: string;
  status: string;
  pid: number | null;
  restart_count: number;
  source_url: string;
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
  const videoRef = useRef<HTMLImageElement>(null);
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
  const { vessels, isLoading, error, isConnected, fps, timestampMs } = useDetectionsWebSocket({
    url: wsUrl,
    enabled: wsEnabled,
  });

  // Calculate video transform for accurate POI positioning
  const videoTransform = useVideoTransform(
    videoRef,
    containerRef,
    videoFitMode,
    VIDEO_CONFIG.WIDTH,
    VIDEO_CONFIG.HEIGHT,
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

  // When the browser tab becomes visible again, force a fresh MJPEG connection.
  // Browsers often silently drop streaming connections for background tabs and
  // don't fire onError, so the img stays frozen/dark without this.
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
  }, [activeStreamId]);

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

  const activeStreamVideoSource = useMemo(
    () => `${apiBase}/api/video/mjpeg/${activeStreamId}?v=${videoSession}`,
    [activeStreamId, apiBase, videoSession]
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
                <img
                  key={activeStreamVideoSource}
                  ref={videoRef}
                  src={activeStreamVideoSource}
                  alt={`Video stream ${activeStream.stream_id}`}
                  className="background-video"
                  style={{ objectFit: videoFitMode }}
                  onLoad={() => {
                    imageLoadedRef.current = true;
                    reconnectCountRef.current = 0;
                    setImageLoaded(true);
                    clearReconnectTimers();
                    if (
                      controlError?.startsWith("Video stream") ||
                      controlError?.startsWith("Waiting for first video frame")
                    ) {
                      setControlError(null);
                    }
                  }}
                  onError={() => {
                    imageLoadedRef.current = false;
                    setImageLoaded(false);
                    scheduleReconnect("Video stream reconnecting");
                  }}
                />

                {!imageLoaded && (
                  <div className="status-overlay">Starting stream — waiting for first frame...</div>
                )}
                {isLoading && imageLoaded && (
                  <div className="status-overlay">Connecting to detection stream...</div>
                )}
                {error && <div className="status-overlay status-error">Error: {error}</div>}
                {!isLoading && !error && (
                  <div className="status-overlay status-info">
                    {isConnected ? "Connected" : "Disconnected"} | Stream: {activeStreamId} | Time:{" "}
                    {`${String(Math.floor(timestampMs / 60000)).padStart(2, "0")}:${String(Math.floor((timestampMs % 60000) / 1000)).padStart(2, "0")}`}{" "}
                    | Detection: {(fps ?? 0).toFixed(1)} FPS | Vessels: {vessels.length}
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
