import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
import { useAuth } from "../hooks/useAuth";
import { DETECTION_CONFIG } from "../config/video";
import { apiFetch as apiFetchLib } from "../lib/api-client";
import { readJsonSafely, explainFetchError } from "../utils/api-helpers";
import type { StreamSummary } from "../types/stream";
import AuthGate from "../components/auth/AuthGate";
import StreamSetup from "../components/stream-setup/StreamSetup";
import "./Datavision.css";

interface TabSelectedDetail {
  tab: TabData;
  id: string;
  index: number;
}

const STREAM_SELECTION_STORAGE_KEY = "openar.selectedStreamId";
const JOINED_STREAMS_STORAGE_KEY = "openar.joinedStreamIds";

function nextAvailableStreamId(runningStreams: StreamSummary[], joinedStreamIds: string[]): string {
  const existing = new Set([...runningStreams.map((s) => s.stream_id), ...joinedStreamIds]);
  let index = 1;
  let candidate = "stream";
  while (existing.has(candidate)) {
    index += 1;
    candidate = `stream-${index}`;
  }
  return candidate;
}

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
    if (!raw) return ["default"];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return ["default"];
    return parsed as string[];
  } catch {
    return ["default"];
  }
};

// ---------------------------------------------------------------------------
// Reducer: single atomic state for all stream/tab management
// ---------------------------------------------------------------------------

interface StreamState {
  activeStreamId: string;
  joinedStreamIds: string[];
  runningStreams: StreamSummary[];
  /** Tab ID currently showing the setup view, or null if none. */
  setupTabId: string | null;
  wsEnabled: boolean;
  hasLoadedStreamList: boolean;
}

type StreamAction =
  | { type: "ADD_TAB"; tabId: string }
  | { type: "CLOSE_TAB"; streamId: string }
  | { type: "SELECT_TAB"; streamId: string }
  | { type: "STREAM_READY"; streamId: string }
  | { type: "SET_RUNNING_STREAMS"; streams: StreamSummary[] }
  | { type: "SELECT_EXTERNAL_STREAM"; streamId: string };

function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case "ADD_TAB": {
      const { tabId } = action;
      return {
        ...state,
        setupTabId: tabId,
        joinedStreamIds: state.joinedStreamIds.includes(tabId)
          ? state.joinedStreamIds
          : [...state.joinedStreamIds, tabId],
        activeStreamId: tabId,
        wsEnabled: false,
      };
    }

    case "CLOSE_TAB": {
      const { streamId } = action;
      const isSetupTab = state.setupTabId === streamId;

      const nextJoined = state.joinedStreamIds.filter((id) => id !== streamId);
      // Setup tabs have no running stream entry to remove
      const nextRunning = isSetupTab
        ? state.runningStreams
        : state.runningStreams.filter((s) => s.stream_id !== streamId);

      let nextActive = state.activeStreamId;
      let nextWs = state.wsEnabled;
      let nextSetup = isSetupTab ? null : state.setupTabId;

      if (state.activeStreamId === streamId) {
        const fallback = nextJoined[0];
        if (fallback) {
          nextActive = fallback;
          nextWs = nextSetup !== fallback;
        } else {
          // No tabs left — show setup for a new stream
          const newId = nextAvailableStreamId(nextRunning, nextJoined);
          nextActive = newId;
          nextSetup = newId;
          nextJoined.push(newId);
          nextWs = false;
        }
      }

      return {
        ...state,
        joinedStreamIds: nextJoined,
        runningStreams: nextRunning,
        setupTabId: nextSetup,
        activeStreamId: nextActive,
        wsEnabled: nextWs,
      };
    }

    case "SELECT_TAB": {
      const { streamId } = action;
      const isSetup = state.setupTabId === streamId;
      return {
        ...state,
        activeStreamId: streamId,
        wsEnabled: !isSetup,
      };
    }

    case "STREAM_READY": {
      const { streamId } = action;
      // Replace the setup tab's joined entry with the real stream ID.
      // Important: check the *filtered* list, not the original, to avoid
      // dropping the stream when setupTabId === streamId.
      const filtered = state.setupTabId
        ? state.joinedStreamIds.filter((id) => id !== state.setupTabId)
        : state.joinedStreamIds;
      const nextJoined = filtered.includes(streamId) ? filtered : [...filtered, streamId];
      return {
        ...state,
        setupTabId: null,
        joinedStreamIds: nextJoined,
        activeStreamId: streamId,
        wsEnabled: true,
      };
    }

    case "SET_RUNNING_STREAMS": {
      const { streams } = action;
      const prev = new Map(state.runningStreams.map((s) => [`${s.stream_id}:${s.status}`, true]));
      const streamsUnchanged =
        state.runningStreams.length === streams.length &&
        streams.every((s) => prev.has(`${s.stream_id}:${s.status}`));
      if (streamsUnchanged && state.hasLoadedStreamList) return state;

      // Inline sync: prune joined list against new running streams.
      // Keep the active stream even if not yet in the running list
      // (it may still be starting up after upload).
      const available = new Set(streams.map((s) => s.stream_id));
      const nextJoined = state.joinedStreamIds.filter(
        (id) => id === state.setupTabId || id === state.activeStreamId || available.has(id)
      );
      const withDefault =
        nextJoined.length > 0 || !available.has("default") ? nextJoined : ["default"];

      // On first load, if all user-configured streams were pruned
      // (only "default" left) and there's no setup tab, create one so
      // the user can configure a new stream without having to refresh.
      let nextSetup = state.setupTabId;
      if (!state.hasLoadedStreamList && !nextSetup && !withDefault.some((id) => id !== "default")) {
        const newTabId = nextAvailableStreamId(streams, withDefault);
        nextSetup = newTabId;
        withDefault.push(newTabId);
      }

      // Fix active stream if it's no longer in the joined list
      let nextActive = state.activeStreamId;
      let nextWs = state.wsEnabled;
      if (!withDefault.includes(nextActive) && nextSetup !== nextActive) {
        nextActive = withDefault[0] ?? "default";
        nextWs = nextSetup !== nextActive;
        if (!withDefault.includes(nextActive)) {
          withDefault.push(nextActive);
        }
      }

      return {
        ...state,
        runningStreams: streams,
        hasLoadedStreamList: true,
        joinedStreamIds: withDefault,
        setupTabId: nextSetup,
        activeStreamId: nextActive,
        wsEnabled: nextWs,
      };
    }

    case "SELECT_EXTERNAL_STREAM": {
      const { streamId } = action;
      const nextJoined = state.joinedStreamIds.includes(streamId)
        ? state.joinedStreamIds
        : [...state.joinedStreamIds, streamId];
      return {
        ...state,
        joinedStreamIds: nextJoined,
        activeStreamId: streamId,
        wsEnabled: true,
      };
    }

    default:
      return state;
  }
}

function initStreamState(): StreamState {
  const joined = getInitialJoinedStreams();
  const hasConfiguredStreams = joined.some((id) => id !== "default");
  // First-time users (only "default" in joined) get the setup tab so they
  // can configure a stream.  Returning users skip it.
  const setupTabId = hasConfiguredStreams ? null : "stream";
  if (setupTabId && !joined.includes(setupTabId)) {
    joined.push(setupTabId);
  }
  return {
    activeStreamId: hasConfiguredStreams ? getInitialActiveStreamId() : setupTabId!,
    joinedStreamIds: joined,
    runningStreams: [],
    setupTabId,
    wsEnabled: hasConfiguredStreams,
    hasLoadedStreamList: false,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DatavisionProps {
  /** Set by App.tsx when the user picks a stream from the navigation menu. */
  externalStreamId?: string | null;
  onAuthGateVisibleChange?: (visible: boolean) => void;
}

function Datavision({ externalStreamId, onAuthGateVisibleChange }: DatavisionProps = {}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { videoFitMode, detectionVisible, multiStreamTestingEnabled } = useSettings();
  const auth = useAuth();
  const [controlError, setControlError] = useState<string | null>(null);
  const [videoSession, setVideoSession] = useState(0);
  const [videoState, setVideoState] = useState<VideoPlayerState>({
    transport: "webrtc",
    status: "idle",
    error: null,
  });
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageLoadedRef = useRef(false);
  const reconnectCountRef = useRef(0);
  const firstFrameRetryDoneRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const firstFrameWatchdogRef = useRef<number | null>(null);
  const [clockTickMs, setClockTickMs] = useState(() => performance.now());
  const detectionClockRef = useRef<Record<string, { timestampMs: number; perfMs: number }>>({});
  const frameClockRef = useRef<Record<string, { timestampMs: number; perfMs: number }>>({});
  const [videoDisplayMs, setVideoDisplayMs] = useState(0);
  const pendingLatencyRef = useRef<Array<{ sourceTsMs: number; frameSentAtMs: number }>>([]);
  const [lastDisplayLatencyMs, setLastDisplayLatencyMs] = useState<number | null>(null);
  const [displayLatencySamples, setDisplayLatencySamples] = useState<number[]>([]);
  const MAX_RECONNECT_ATTEMPTS = 8;

  const [state, dispatch] = useReducer(streamReducer, undefined, initStreamState);
  const { activeStreamId, joinedStreamIds, runningStreams, setupTabId, wsEnabled } = state;

  const activeIsSetup = setupTabId === activeStreamId;
  const showingAuthGate = activeIsSetup && !auth.session;

  useEffect(() => {
    onAuthGateVisibleChange?.(showingAuthGate);
  }, [showingAuthGate, onAuthGateVisibleChange]);

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
    (reason: string) => {
      if (reconnectCountRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setControlError(`${reason} — gave up after ${MAX_RECONNECT_ATTEMPTS} attempts`);
        return;
      }
      reconnectCountRef.current += 1;
      const delay = Math.min(2000 * Math.pow(1.5, reconnectCountRef.current - 1), 15000);
      setControlError(`${reason} (attempt ${reconnectCountRef.current})...`);
      reconnectTimerRef.current = window.setTimeout(() => {
        setVideoSession((prev) => prev + 1);
      }, delay);
    },
    [MAX_RECONNECT_ATTEMPTS]
  );

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
      const response = await apiFetchLib("/api/streams");
      const payload = (await readJsonSafely(response)) as {
        detail?: string;
        streams?: StreamSummary[];
      };
      if (!response.ok) {
        throw new Error(payload.detail || "Failed to load streams");
      }
      const streams = Array.isArray(payload.streams) ? payload.streams : [];
      dispatch({ type: "SET_RUNNING_STREAMS", streams });
    } catch (err) {
      setControlError(explainFetchError(err, "Failed to load streams"));
    }
  }, []);

  // On mount: fetch stream list and ensure a default stream is running
  useEffect(() => {
    const ensureDefaultStream = async () => {
      try {
        const response = await apiFetchLib("/api/streams");
        const payload = (await readJsonSafely(response)) as {
          detail?: string;
          streams?: StreamSummary[];
        };
        if (!response.ok) throw new Error(payload.detail || "Failed to load streams");
        let streams = Array.isArray(payload.streams) ? payload.streams : [];
        dispatch({ type: "SET_RUNNING_STREAMS", streams });

        const hasDefault = streams.some((s) => s.stream_id === "default");
        if (!hasDefault) {
          const startResp = await apiFetchLib("/api/streams/default/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ loop: true }),
          });
          if (!startResp.ok && startResp.status !== 409) {
            const p = (await readJsonSafely(startResp)) as {
              detail?: string;
            };
            throw new Error(p.detail || "Failed to start default stream");
          }
          // Re-fetch after starting
          const refetchResp = await apiFetchLib("/api/streams");
          const refetchPayload = (await readJsonSafely(refetchResp)) as {
            detail?: string;
            streams?: StreamSummary[];
          };
          if (refetchResp.ok) {
            streams = Array.isArray(refetchPayload.streams) ? refetchPayload.streams : [];
            dispatch({ type: "SET_RUNNING_STREAMS", streams });
          }
        }
      } catch (err) {
        setControlError(explainFetchError(err, "Failed to initialize streams"));
      }
    };
    ensureDefaultStream();
  }, []);

  // Heartbeats — use refs so the interval doesn't re-fire on every state change
  const joinedIdsRef = useRef(joinedStreamIds);
  joinedIdsRef.current = joinedStreamIds;
  const setupTabIdRef = useRef(setupTabId);
  setupTabIdRef.current = setupTabId;

  useEffect(() => {
    const interval = window.setInterval(() => {
      for (const id of joinedIdsRef.current) {
        if (id === setupTabIdRef.current) continue;
        apiFetchLib(`/api/streams/${encodeURIComponent(id)}/heartbeat`, { method: "POST" }).catch(
          () => {}
        );
      }
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

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

  // Reset video state when stream or session changes
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

  // Poll stream list when multi-stream testing is enabled
  useEffect(() => {
    if (!multiStreamTestingEnabled) return;
    const interval = window.setInterval(() => {
      refreshStreams();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [multiStreamTestingEnabled, refreshStreams]);

  // Persist active stream to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STREAM_SELECTION_STORAGE_KEY, activeStreamId);
    } catch {
      // Ignore storage errors.
    }
  }, [activeStreamId]);

  // Persist joined streams to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(JOINED_STREAMS_STORAGE_KEY, JSON.stringify(joinedStreamIds));
    } catch {
      // Ignore storage errors.
    }
  }, [joinedStreamIds]);

  // React to parent (App.tsx) selecting a stream from the nav menu
  const prevExternalStreamIdRef = useRef(externalStreamId);
  useEffect(() => {
    if (externalStreamId && externalStreamId !== prevExternalStreamIdRef.current) {
      dispatch({
        type: "SELECT_EXTERNAL_STREAM",
        streamId: externalStreamId,
      });
      refreshStreams().catch(() => {});
    }
    prevExternalStreamIdRef.current = externalStreamId;
  }, [externalStreamId, refreshStreams]);

  const { streamTabs, activeStream, hasConfiguredStreams } = useMemo(() => {
    const byId = new Map(runningStreams.map((stream) => [stream.stream_id, stream] as const));

    // Visible streams: joined streams that are actually running
    let visible = joinedStreamIds
      .filter((id) => id !== setupTabId)
      .map((id) => byId.get(id))
      .filter((stream): stream is StreamSummary => Boolean(stream))
      .slice(0, 5);
    if (visible.length === 0) {
      const fallbackDefault = byId.get("default");
      visible = fallbackDefault ? [fallbackDefault] : [];
    }

    // Tabs for running streams
    const streamEntries: TabData[] = visible.map((stream) => ({
      id: stream.stream_id,
      title: stream.stream_id === "default" ? "Example" : stream.stream_id,
    }));

    // Add tabs for joined streams that aren't running yet (still starting)
    const visibleIds = new Set(visible.map((s) => s.stream_id));
    for (const id of joinedStreamIds) {
      if (id !== setupTabId && !visibleIds.has(id)) {
        streamEntries.push({ id, title: `${id} (starting...)` });
      }
    }

    let tabs: TabData[];
    if (setupTabId) {
      const setupTab: TabData = { id: setupTabId, title: "Configure" };
      tabs =
        streamEntries.length === 0
          ? [{ id: "default", title: "Example", disabled: true }, setupTab]
          : [...streamEntries, setupTab];
    } else {
      tabs = streamEntries;
    }

    return {
      streamTabs: tabs,
      activeStream: visible.find((s) => s.stream_id === activeStreamId) ?? null,
      hasConfiguredStreams: runningStreams.some(
        (s) => s.stream_id !== "default" && s.status !== "setup"
      ),
    };
  }, [joinedStreamIds, runningStreams, setupTabId, activeStreamId]);

  const handleTabSelected = (event: CustomEvent<TabSelectedDetail>) => {
    const streamId = event.detail?.id;
    if (!streamId) return;
    dispatch({ type: "SELECT_TAB", streamId });
  };

  const handleTabClosed = async (event: CustomEvent<{ id?: string }>) => {
    const streamId = event.detail?.id?.trim();
    if (!streamId) return;

    const isSetup = setupTabId === streamId;
    dispatch({ type: "CLOSE_TAB", streamId });

    if (!isSetup) {
      try {
        const response = await apiFetchLib(`/api/streams/${encodeURIComponent(streamId)}`, {
          method: "DELETE",
        });
        if (!response.ok && response.status !== 404) {
          const payload = (await readJsonSafely(response)) as {
            detail?: string;
          };
          throw new Error(payload.detail || "Failed to stop stream");
        }
      } catch (err) {
        setControlError(explainFetchError(err, "Failed to stop stream"));
      }
    }
  };

  const handleAddTab = () => {
    const candidate = nextAvailableStreamId(runningStreams, joinedStreamIds);
    dispatch({ type: "ADD_TAB", tabId: candidate });
  };

  const handleStreamReady = useCallback(
    (streamId: string) => {
      dispatch({ type: "STREAM_READY", streamId });
      refreshStreams().catch(() => {});
    },
    [refreshStreams]
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
            hasAddNewTab={hasConfiguredStreams}
            hasClose={hasConfiguredStreams}
            onTabSelected={handleTabSelected}
            onTabClosed={handleTabClosed}
            onAddNewTab={handleAddTab}
          />

          <div
            ref={containerRef}
            className={[
              "stream-card-content",
              activeIsSetup ? "" : !activeStream ? "stream-card-content--empty" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {activeIsSetup && (
              <>
                {!auth.session ? (
                  <div className="stream-setup-auth">
                    <AuthGate initialMode="login" onAuthenticated={auth.handleAuthenticated} />
                  </div>
                ) : (
                  <StreamSetup tabId={activeStreamId} onStreamReady={handleStreamReady} />
                )}
              </>
            )}

            {!activeIsSetup &&
              !activeStream &&
              "No running streams. Join or create one from the sidebar."}

            {!activeIsSetup && activeStream && (
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
