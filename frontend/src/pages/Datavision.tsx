import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ObcTabRow } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import type { TabData } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import PoiOverlay from "../components/poi-overlay/PoiOverlay";
import { useDetectionsWebSocket } from "../hooks/useDetectionsWebSocket";
import { useMjpegStream } from "../hooks/useMjpegStream";
import { useVideoTransform } from "../hooks/useVideoTransform";
import { useSettings } from "../contexts/useSettings";
import { useAuth } from "../hooks/useAuth";
import { VIDEO_CONFIG, DETECTION_CONFIG } from "../config/video";
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
      // Replace the setup tab's joined entry with the real stream ID
      const nextJoined = state.setupTabId
        ? state.joinedStreamIds
            .filter((id) => id !== state.setupTabId)
            .concat(state.joinedStreamIds.includes(streamId) ? [] : [streamId])
        : state.joinedStreamIds.includes(streamId)
          ? state.joinedStreamIds
          : [...state.joinedStreamIds, streamId];
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

      // Inline sync: prune joined list against new running streams
      const available = new Set(streams.map((s) => s.stream_id));
      const nextJoined = state.joinedStreamIds.filter(
        (id) => id === state.setupTabId || available.has(id)
      );
      const withDefault =
        nextJoined.length > 0 || !available.has("default") ? nextJoined : ["default"];

      // Fix active stream if it's no longer in the joined list
      let nextActive = state.activeStreamId;
      let nextWs = state.wsEnabled;
      if (!withDefault.includes(nextActive) && state.setupTabId !== nextActive) {
        nextActive = withDefault[0] ?? "default";
        nextWs = state.setupTabId !== nextActive;
        if (!withDefault.includes(nextActive)) {
          withDefault.push(nextActive);
        }
      }

      return {
        ...state,
        runningStreams: streams,
        hasLoadedStreamList: true,
        joinedStreamIds: withDefault,
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
  const videoRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { videoFitMode, detectionVisible, multiStreamTestingEnabled } = useSettings();
  const auth = useAuth();
  const [controlError, setControlError] = useState<string | null>(null);

  const [state, dispatch] = useReducer(streamReducer, undefined, initStreamState);
  const { activeStreamId, joinedStreamIds, runningStreams, setupTabId, wsEnabled } = state;

  const activeIsSetup = setupTabId === activeStreamId;
  const showingAuthGate = activeIsSetup && !auth.session;

  useEffect(() => {
    onAuthGateVisibleChange?.(showingAuthGate);
  }, [showingAuthGate, onAuthGateVisibleChange]);

  const mjpegEnabled = !activeIsSetup;
  const {
    imgSrc,
    imageLoaded,
    reconnectError,
    onLoad: onImgLoad,
    onError: onImgError,
  } = useMjpegStream(activeStreamId, mjpegEnabled);

  const wsUrl = useMemo(() => DETECTION_CONFIG.WS_URL(activeStreamId), [activeStreamId]);

  const { vessels, isLoading, error, isConnected, fps, timestampMs } = useDetectionsWebSocket({
    url: wsUrl,
    enabled: wsEnabled,
  });

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

    // Tabs
    const streamEntries: TabData[] = visible.map((stream) => ({
      id: stream.stream_id,
      title: stream.stream_id === "default" ? "Example" : stream.stream_id,
    }));
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

  const videoError = reconnectError || controlError;

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
                <img
                  ref={videoRef}
                  src={imgSrc}
                  alt={`Video stream ${activeStream.stream_id}`}
                  className="background-video"
                  style={{ objectFit: videoFitMode }}
                  onLoad={onImgLoad}
                  onError={onImgError}
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
                    {videoError ? ` | Control: ${videoError}` : ""}
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
