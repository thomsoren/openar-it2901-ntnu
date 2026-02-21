import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { TabData } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import { apiFetch } from "../lib/api-client";
import { readJsonSafely, explainFetchError } from "../utils/api-helpers";
import type { StreamSummary } from "../types/stream";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTIVE_TAB_STORAGE_KEY = "openar.selectedStreamId";
const JOINED_STREAMS_STORAGE_KEY = "openar.joinedStreamIds";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function loadActiveTabId(): string {
  try {
    const stored = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return stored?.trim() || "default";
  } catch {
    return "default";
  }
}

function loadJoinedStreams(): string[] {
  try {
    const raw = localStorage.getItem(JOINED_STREAMS_STORAGE_KEY);
    if (!raw) return ["default"];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return ["default"];
    return parsed as string[];
  } catch {
    return ["default"];
  }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

interface StreamTabState {
  activeTabId: string;
  joinedStreamIds: string[];
  runningStreams: StreamSummary[];
  configureTabId: string | null;
  hasLoadedStreamList: boolean;
}

type StreamTabAction =
  | { type: "ADD_CONFIGURE_TAB" }
  | { type: "CLOSE_TAB"; tabId: string }
  | { type: "SELECT_TAB"; tabId: string }
  | { type: "CONFIGURE_COMPLETE"; streamId: string }
  | { type: "SET_RUNNING_STREAMS"; streams: StreamSummary[] }
  | { type: "JOIN_EXTERNAL_STREAM"; streamId: string };

function streamTabReducer(state: StreamTabState, action: StreamTabAction): StreamTabState {
  switch (action.type) {
    case "ADD_CONFIGURE_TAB": {
      if (state.configureTabId) return state;
      const tabId = nextAvailableStreamId(state.runningStreams, state.joinedStreamIds);
      return {
        ...state,
        configureTabId: tabId,
        joinedStreamIds: [...state.joinedStreamIds, tabId],
        activeTabId: tabId,
      };
    }

    case "CLOSE_TAB": {
      const { tabId } = action;
      if (tabId === "default") return state;

      const isConfigureTab = state.configureTabId === tabId;
      const nextJoined = state.joinedStreamIds.filter((id) => id !== tabId);
      const nextRunning = isConfigureTab
        ? state.runningStreams
        : state.runningStreams.filter((s) => s.stream_id !== tabId);
      let nextConfigureTab: string | null = isConfigureTab ? null : state.configureTabId;
      let nextActive = state.activeTabId;

      if (state.activeTabId === tabId) {
        nextActive = nextJoined[0] ?? "default";
      }

      // If no configured streams remain, auto-create a configure tab
      const hasConfigured = nextJoined.some((id) => id !== "default" && id !== nextConfigureTab);
      if (!hasConfigured && !nextConfigureTab) {
        const newId = nextAvailableStreamId(nextRunning, nextJoined);
        nextConfigureTab = newId;
        nextJoined.push(newId);
      }

      return {
        ...state,
        joinedStreamIds: nextJoined,
        runningStreams: nextRunning,
        configureTabId: nextConfigureTab,
        activeTabId: nextActive,
      };
    }

    case "SELECT_TAB": {
      return { ...state, activeTabId: action.tabId };
    }

    case "CONFIGURE_COMPLETE": {
      const { streamId } = action;
      const filtered = state.configureTabId
        ? state.joinedStreamIds.filter((id) => id !== state.configureTabId)
        : state.joinedStreamIds;
      const nextJoined = filtered.includes(streamId) ? filtered : [...filtered, streamId];
      return {
        ...state,
        configureTabId: null,
        joinedStreamIds: nextJoined,
        activeTabId: streamId,
      };
    }

    case "SET_RUNNING_STREAMS": {
      const { streams } = action;

      const prev = new Map(state.runningStreams.map((s) => [`${s.stream_id}:${s.status}`, true]));
      const unchanged =
        state.runningStreams.length === streams.length &&
        streams.every((s) => prev.has(`${s.stream_id}:${s.status}`));
      if (unchanged && state.hasLoadedStreamList) return state;

      const available = new Set(streams.map((s) => s.stream_id));
      const nextJoined = state.joinedStreamIds.filter(
        (id) =>
          id === "default" ||
          id === state.configureTabId ||
          id === state.activeTabId ||
          available.has(id)
      );
      if (!nextJoined.includes("default")) {
        nextJoined.unshift("default");
      }

      let nextActive = state.activeTabId;
      let nextConfigureTab = state.configureTabId;

      if (!nextJoined.includes(nextActive) && nextConfigureTab !== nextActive) {
        nextActive = nextJoined[0] ?? "default";
        if (!nextJoined.includes(nextActive)) {
          nextJoined.push(nextActive);
        }
      }

      // If no configured streams remain, ensure a configure tab exists
      const hasConfigured = nextJoined.some((id) => id !== "default" && id !== nextConfigureTab);
      if (!hasConfigured && !nextConfigureTab) {
        const newId = nextAvailableStreamId(streams, nextJoined);
        nextConfigureTab = newId;
        nextJoined.push(newId);
      }

      return {
        ...state,
        runningStreams: streams,
        hasLoadedStreamList: true,
        joinedStreamIds: nextJoined,
        configureTabId: nextConfigureTab,
        activeTabId: nextActive,
      };
    }

    case "JOIN_EXTERNAL_STREAM": {
      const { streamId } = action;
      const nextJoined = state.joinedStreamIds.includes(streamId)
        ? state.joinedStreamIds
        : [...state.joinedStreamIds, streamId];
      return {
        ...state,
        joinedStreamIds: nextJoined,
        activeTabId: streamId,
      };
    }

    default:
      return state;
  }
}

function initStreamTabState(): StreamTabState {
  const joined = loadJoinedStreams();
  if (!joined.includes("default")) {
    joined.unshift("default");
  }

  const hasConfigured = joined.some((id) => id !== "default");
  const configureTabId = hasConfigured ? null : "stream";
  if (configureTabId && !joined.includes(configureTabId)) {
    joined.push(configureTabId);
  }

  return {
    activeTabId: hasConfigured ? loadActiveTabId() : "default",
    joinedStreamIds: joined,
    runningStreams: [],
    configureTabId,
    hasLoadedStreamList: false,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface TabSelectedDetail {
  tab: TabData;
  id: string;
  index: number;
}

export interface UseStreamTabsOptions {
  externalStreamId?: string | null;
  multiStreamTestingEnabled?: boolean;
}

export interface UseStreamTabsReturn {
  tabs: TabData[];
  activeTabId: string;
  showAddButton: boolean;
  showCloseButtons: boolean;
  activeIsSetup: boolean;
  activeStream: StreamSummary | null;
  wsEnabled: boolean;
  handleTabSelected: (event: CustomEvent<TabSelectedDetail>) => void;
  handleTabClosed: (tabId: string) => void;
  handleAddTab: () => void;
  handleStreamReady: (streamId: string) => void;
  runningStreams: StreamSummary[];
  joinedStreamIds: string[];
  configureTabId: string | null;
  refreshStreams: () => Promise<void>;
  streamError: string | null;
}

export function useStreamTabs(options: UseStreamTabsOptions = {}): UseStreamTabsReturn {
  const { externalStreamId, multiStreamTestingEnabled } = options;

  const [state, dispatch] = useReducer(streamTabReducer, undefined, initStreamTabState);
  const { activeTabId, joinedStreamIds, runningStreams, configureTabId } = state;

  const [streamError, setStreamError] = useState<string | null>(null);

  // --- Derived values ---
  const activeIsSetup = configureTabId === activeTabId;
  const wsEnabled = !activeIsSetup;

  const hasConfiguredStreams = joinedStreamIds.some(
    (id) => id !== "default" && id !== configureTabId
  );
  const showAddButton = hasConfiguredStreams;
  const showCloseButtons = hasConfiguredStreams;

  // --- Tab computation (single pass) ---
  const { tabs, activeStream } = useMemo(() => {
    const byId = new Map(runningStreams.map((s) => [s.stream_id, s] as const));
    const result: TabData[] = [];
    const seen = new Set<string>();

    // Example tab always first
    result.push({ id: "default", title: "Example" });
    seen.add("default");

    // Joined stream tabs (excluding default and configure tab)
    for (const id of joinedStreamIds) {
      if (seen.has(id) || id === configureTabId) continue;
      seen.add(id);
      const stream = byId.get(id);
      result.push({ id, title: stream ? id : `${id} (starting...)` });
    }

    // Configure tab last
    if (configureTabId) {
      result.push({ id: configureTabId, title: "Configure" });
    }

    const active = runningStreams.find((s) => s.stream_id === activeTabId) ?? null;
    return { tabs: result, activeStream: active };
  }, [joinedStreamIds, runningStreams, configureTabId, activeTabId]);

  // --- Refresh streams from backend ---
  const refreshStreams = useCallback(async () => {
    try {
      const response = await apiFetch("/api/streams");
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
      setStreamError(explainFetchError(err, "Failed to load streams"));
    }
  }, []);

  // --- On mount: ensure default stream is running ---
  useEffect(() => {
    const ensureDefaultStream = async () => {
      try {
        const response = await apiFetch("/api/streams");
        const payload = (await readJsonSafely(response)) as {
          detail?: string;
          streams?: StreamSummary[];
        };
        if (!response.ok) throw new Error(payload.detail || "Failed to load streams");
        let streams = Array.isArray(payload.streams) ? payload.streams : [];
        dispatch({ type: "SET_RUNNING_STREAMS", streams });

        const hasDefault = streams.some((s) => s.stream_id === "default");
        if (!hasDefault) {
          const startResp = await apiFetch("/api/streams/default/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ loop: true }),
          });
          if (!startResp.ok && startResp.status !== 409) {
            const p = (await readJsonSafely(startResp)) as { detail?: string };
            throw new Error(p.detail || "Failed to start default stream");
          }
          const refetchResp = await apiFetch("/api/streams");
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
        setStreamError(explainFetchError(err, "Failed to initialize streams"));
      }
    };
    ensureDefaultStream();
  }, []);

  // --- Heartbeats ---
  const joinedIdsRef = useRef(joinedStreamIds);
  joinedIdsRef.current = joinedStreamIds;
  const configureTabIdRef = useRef(configureTabId);
  configureTabIdRef.current = configureTabId;

  useEffect(() => {
    const interval = window.setInterval(() => {
      for (const id of joinedIdsRef.current) {
        if (id === configureTabIdRef.current) continue;
        apiFetch(`/api/streams/${encodeURIComponent(id)}/heartbeat`, {
          method: "POST",
        }).catch(() => {});
      }
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  // --- Persist active tab ---
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTabId);
    } catch {
      // Ignore storage errors
    }
  }, [activeTabId]);

  // --- Persist joined streams ---
  useEffect(() => {
    try {
      localStorage.setItem(JOINED_STREAMS_STORAGE_KEY, JSON.stringify(joinedStreamIds));
    } catch {
      // Ignore storage errors
    }
  }, [joinedStreamIds]);

  // --- React to external stream selection from App.tsx ---
  const prevExternalStreamIdRef = useRef(externalStreamId);
  useEffect(() => {
    if (externalStreamId && externalStreamId !== prevExternalStreamIdRef.current) {
      dispatch({ type: "JOIN_EXTERNAL_STREAM", streamId: externalStreamId });
      refreshStreams().catch(() => {});
    }
    prevExternalStreamIdRef.current = externalStreamId;
  }, [externalStreamId, refreshStreams]);

  // --- Poll stream list when multi-stream testing is enabled ---
  useEffect(() => {
    if (!multiStreamTestingEnabled) return;
    const interval = window.setInterval(() => {
      refreshStreams();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [multiStreamTestingEnabled, refreshStreams]);

  // --- Handlers ---
  const handleTabSelected = useCallback((event: CustomEvent<TabSelectedDetail>) => {
    const tabId = event.detail?.id;
    if (!tabId) return;
    dispatch({ type: "SELECT_TAB", tabId });
  }, []);

  const handleTabClosed = useCallback((tabId: string) => {
    dispatch({ type: "CLOSE_TAB", tabId });
  }, []);

  const handleAddTab = useCallback(() => {
    dispatch({ type: "ADD_CONFIGURE_TAB" });
  }, []);

  const handleStreamReady = useCallback(
    (streamId: string) => {
      dispatch({ type: "CONFIGURE_COMPLETE", streamId });
      refreshStreams().catch(() => {});
    },
    [refreshStreams]
  );

  return {
    tabs,
    activeTabId,
    showAddButton,
    showCloseButtons,
    activeIsSetup,
    activeStream,
    wsEnabled,
    handleTabSelected,
    handleTabClosed,
    handleAddTab,
    handleStreamReady,
    runningStreams,
    joinedStreamIds,
    configureTabId,
    refreshStreams,
    streamError,
  };
}
