import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function Datavision() {
  const videoRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const firstFrameWatchdogRef = useRef<number | null>(null);
  const reconnectCountRef = useRef(0);
  const imageLoadedRef = useRef(false);
  const { videoFitMode, detectionVisible, multiStreamTestingEnabled } = useSettings();
  const [imageLoaded, setImageLoaded] = useState(false);
  const [newStreamId, setNewStreamId] = useState("alpha");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [selectedStreamId, setSelectedStreamId] = useState("default");
  const [activeStreamId, setActiveStreamId] = useState("default");
  const [controlError, setControlError] = useState<string | null>(null);
  const [controlBusy, setControlBusy] = useState(false);
  const [runningStreams, setRunningStreams] = useState<StreamSummary[]>([]);
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

  const videoSource = useMemo(
    () => `${apiBase}/api/video/mjpeg/${activeStreamId}?v=${videoSession}`,
    [activeStreamId, apiBase, videoSession]
  );

  const wsUrl = useMemo(() => DETECTION_CONFIG.WS_URL(activeStreamId), [activeStreamId]);

  // Receive detection updates via WebSocket (runs at YOLO speed ~5 FPS)
  // Video plays independently at native 25 FPS
  const { vessels, isLoading, error, isConnected, fps } = useDetectionsWebSocket({
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
      setSelectedStreamId((prev) => {
        if (streams.some((stream) => stream.stream_id === prev)) {
          return prev;
        }
        if (streams.some((stream) => stream.stream_id === activeStreamId)) {
          return activeStreamId;
        }
        return streams[0]?.stream_id ?? prev;
      });
    } catch (err) {
      setControlError(explainFetchError(err, "Failed to load streams"));
    }
  }, [activeStreamId, apiFetch]);

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
        setControlError(`Video stream '${activeStreamId}' is unavailable after retries.`);
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

  const startStream = async (streamId: string, sourceUrl?: string) => {
    if (!streamId) {
      setControlError("Stream ID is required");
      return;
    }

    setControlBusy(true);
    setControlError(null);
    try {
      const body: { source_url?: string; loop: boolean } = { loop: true };
      if (sourceUrl && sourceUrl.trim()) {
        body.source_url = sourceUrl.trim();
      }

      const response = await apiFetch(`/api/streams/${encodeURIComponent(streamId)}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await readJsonSafely(response);
      if (!response.ok && response.status !== 409) {
        throw new Error(payload.detail || "Failed to start stream");
      }

      setSelectedStreamId(streamId);
      setActiveStreamId(streamId);
      setWsEnabled(true);
      setImageLoaded(false);
      setVideoSession((prev) => prev + 1);
      await refreshStreams();
    } catch (err) {
      setControlError(explainFetchError(err, "Failed to start stream"));
    } finally {
      setControlBusy(false);
    }
  };

  const stopStream = async (streamId: string) => {
    if (!streamId) {
      setControlError("Stream ID is required");
      return;
    }

    setControlBusy(true);
    setControlError(null);
    try {
      const response = await apiFetch(`/api/streams/${encodeURIComponent(streamId)}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404) {
        const payload = await readJsonSafely(response);
        throw new Error(payload.detail || "Failed to stop stream");
      }

      if (streamId === activeStreamId) {
        setWsEnabled(false);
        setImageLoaded(false);
        setVideoSession((prev) => prev + 1);
      }
      await refreshStreams();
    } catch (err) {
      setControlError(explainFetchError(err, "Failed to stop stream"));
    } finally {
      setControlBusy(false);
    }
  };

  const connectToStream = (streamId: string) => {
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
    setVideoSession((prev) => prev + 1);
  };

  const handleCreateAndStart = async () => {
    const streamId = newStreamId.trim();
    await startStream(streamId, newSourceUrl);
  };

  const handleConnectSelected = () => {
    connectToStream(selectedStreamId.trim());
  };

  const handleStopSelected = async () => {
    await stopStream(selectedStreamId.trim());
  };

  useEffect(() => {
    refreshStreams();
  }, [refreshStreams]);

  useEffect(() => {
    reconnectCountRef.current = 0;
  }, [activeStreamId]);

  useEffect(() => {
    imageLoadedRef.current = false;
    clearReconnectTimers();
    firstFrameWatchdogRef.current = window.setTimeout(() => {
      if (imageLoadedRef.current) {
        return;
      }
      scheduleReconnect("Waiting for first video frame from");
    }, 1800);

    return () => {
      clearReconnectTimers();
    };
  }, [activeStreamId, clearReconnectTimers, scheduleReconnect, videoSession]);

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

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* MJPEG stream from backend - synced with detections */}
      <img
        key={videoSource}
        ref={videoRef}
        src={videoSource}
        alt="Video stream"
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

      {multiStreamTestingEnabled && (
        <aside className="stream-panel">
          <div className="stream-panel__header">
            <strong>Multi-Stream Test Console</strong>
            <button type="button" onClick={refreshStreams} disabled={controlBusy}>
              Refresh
            </button>
          </div>

          <section className="stream-panel__section">
            <div className="stream-panel__section-title">Create Stream</div>
            <label className="stream-panel__label">
              <span>Stream Name</span>
              <input
                value={newStreamId}
                onChange={(event) => setNewStreamId(event.target.value)}
                placeholder="alpha"
              />
            </label>
            <label className="stream-panel__label">
              <span>Source URL (optional)</span>
              <input
                value={newSourceUrl}
                onChange={(event) => setNewSourceUrl(event.target.value)}
                placeholder="Defaults to backend VIDEO_PATH"
              />
            </label>
            <button type="button" onClick={handleCreateAndStart} disabled={controlBusy}>
              Create + Start + Connect
            </button>
          </section>

          <section className="stream-panel__section">
            <div className="stream-panel__section-title">Active Streams</div>
            <label className="stream-panel__label">
              <span>Running stream selector</span>
              <select
                value={selectedStreamId}
                onChange={(event) => setSelectedStreamId(event.target.value)}
                disabled={runningStreams.length === 0}
              >
                {runningStreams.length === 0 && <option value="">No running streams</option>}
                {runningStreams.map((stream) => (
                  <option key={stream.stream_id} value={stream.stream_id}>
                    {stream.stream_id}
                  </option>
                ))}
              </select>
            </label>
            <div className="stream-panel__actions">
              <button type="button" onClick={handleConnectSelected} disabled={!selectedStreamId}>
                Connect
              </button>
              <button
                type="button"
                onClick={handleStopSelected}
                disabled={controlBusy || !selectedStreamId}
              >
                Stop
              </button>
            </div>
          </section>

          <section className="stream-panel__section">
            <div className="stream-panel__meta">
              <span>Connected to: {activeStreamId}</span>
              <span>Workers: {runningStreams.length}</span>
            </div>
            <div className="stream-list">
              {runningStreams.length === 0 && (
                <div className="stream-list__empty">No active streams</div>
              )}
              {runningStreams.map((stream) => (
                <div
                  key={stream.stream_id}
                  className={[
                    "stream-chip",
                    stream.stream_id === activeStreamId ? "stream-chip--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className="stream-chip__title">
                    <span>{stream.stream_id}</span>
                    <span>{stream.status}</span>
                  </div>
                  <div className="stream-chip__meta">
                    pid:{stream.pid ?? "-"} | restarts:{stream.restart_count}
                  </div>
                  <div className="stream-chip__actions">
                    <button type="button" onClick={() => connectToStream(stream.stream_id)}>
                      Connect
                    </button>
                    <button
                      type="button"
                      onClick={() => stopStream(stream.stream_id)}
                      disabled={controlBusy}
                    >
                      Stop
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {controlError && <div className="stream-panel__error">Control error: {controlError}</div>}
        </aside>
      )}

      {/* Status overlay */}
      {isLoading && <div className="status-overlay">Connecting to detection stream...</div>}
      {error && <div className="status-overlay status-error">Error: {error}</div>}
      {!isLoading && !error && (
        <div className="status-overlay status-info">
          {isConnected ? "Connected" : "Disconnected"} | Stream: {activeStreamId} | Detection:{" "}
          {(fps ?? 0).toFixed(1)} FPS | Vessels: {vessels.length}
        </div>
      )}

      {/* Vessel markers overlay */}
      {detectionVisible && <PoiOverlay vessels={vessels} videoTransform={videoTransform} />}
    </div>
  );
}

export default Datavision;
