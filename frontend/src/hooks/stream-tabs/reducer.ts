import type { StreamSummary } from "../../types/stream";
import { nextAvailableStreamId } from "./derived";
import { loadActiveTabId, loadJoinedStreams } from "./storage";

export interface StreamTabState {
  activeTabId: string;
  joinedStreamIds: string[];
  runningStreams: StreamSummary[];
  configureTabId: string | null;
  hasLoadedStreamList: boolean;
}

export type StreamTabAction =
  | { type: "ADD_CONFIGURE_TAB" }
  | { type: "CLOSE_TAB"; tabId: string }
  | { type: "SELECT_TAB"; tabId: string }
  | { type: "CONFIGURE_COMPLETE"; streamId: string }
  | { type: "SET_RUNNING_STREAMS"; streams: StreamSummary[] }
  | { type: "JOIN_EXTERNAL_STREAM"; streamId: string };

export function streamTabReducer(state: StreamTabState, action: StreamTabAction): StreamTabState {
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

    case "SELECT_TAB":
      return { ...state, activeTabId: action.tabId };

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

export function initStreamTabState(): StreamTabState {
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
