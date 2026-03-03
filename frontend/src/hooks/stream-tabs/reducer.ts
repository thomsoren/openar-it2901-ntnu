import type { StreamSummary } from "../../types/stream";
import { nextAvailableStreamId } from "./derived";
import { DEFAULT_STREAM_ID, FUSION_MOCK_TAB_ID, FUSION_TAB_ID } from "./constants";
import { loadActiveTabId, loadJoinedStreams } from "./storage";
import { areStreamsEquivalent } from "./running-streams-store";

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
      if (tabId === DEFAULT_STREAM_ID || tabId === FUSION_MOCK_TAB_ID || tabId === FUSION_TAB_ID)
        return state;

      const isConfigureTab = state.configureTabId === tabId;
      const nextJoined = state.joinedStreamIds.filter((id) => id !== tabId);
      const nextRunning = isConfigureTab
        ? state.runningStreams
        : state.runningStreams.filter((s) => s.stream_id !== tabId);
      let nextConfigureTab: string | null = isConfigureTab ? null : state.configureTabId;
      let nextActive = state.activeTabId;

      if (state.activeTabId === tabId) {
        nextActive = nextJoined[0] ?? DEFAULT_STREAM_ID;
      }

      const hasConfigured = nextJoined.some(
        (id) =>
          id !== DEFAULT_STREAM_ID &&
          id !== FUSION_MOCK_TAB_ID &&
          id !== FUSION_TAB_ID &&
          id !== nextConfigureTab
      );
      if (!hasConfigured && !nextConfigureTab) {
        const newId = nextAvailableStreamId(nextRunning, nextJoined);
        nextConfigureTab = newId;
        return {
          ...state,
          joinedStreamIds: [...nextJoined, newId],
          runningStreams: nextRunning,
          configureTabId: nextConfigureTab,
          activeTabId: nextActive,
        };
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

      const unchanged = areStreamsEquivalent(state.runningStreams, streams);
      if (unchanged && state.hasLoadedStreamList) return state;

      const available = new Set(streams.map((s) => s.stream_id));
      const nextJoined = state.joinedStreamIds.filter(
        (id) =>
          id === DEFAULT_STREAM_ID ||
          id === FUSION_MOCK_TAB_ID ||
          id === FUSION_TAB_ID ||
          id === state.configureTabId ||
          id === state.activeTabId ||
          available.has(id)
      );
      const withDefault = nextJoined.includes(DEFAULT_STREAM_ID)
        ? nextJoined
        : [DEFAULT_STREAM_ID, ...nextJoined];

      let nextJoinedIds = withDefault;

      let nextActive = state.activeTabId;
      let nextConfigureTab = state.configureTabId;

      if (!nextJoinedIds.includes(nextActive) && nextConfigureTab !== nextActive) {
        nextActive = nextJoinedIds[0] ?? DEFAULT_STREAM_ID;
        nextJoinedIds = nextJoinedIds.includes(nextActive)
          ? nextJoinedIds
          : [...nextJoinedIds, nextActive];
      }

      const hasConfigured = nextJoinedIds.some(
        (id) =>
          id !== DEFAULT_STREAM_ID &&
          id !== FUSION_MOCK_TAB_ID &&
          id !== FUSION_TAB_ID &&
          id !== nextConfigureTab
      );
      if (!hasConfigured && !nextConfigureTab) {
        const newId = nextAvailableStreamId(streams, nextJoinedIds);
        nextConfigureTab = newId;
        nextJoinedIds = [...nextJoinedIds, newId];
      }

      return {
        ...state,
        runningStreams: streams,
        hasLoadedStreamList: true,
        joinedStreamIds: nextJoinedIds,
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
  if (!joined.includes(DEFAULT_STREAM_ID)) {
    joined.unshift(DEFAULT_STREAM_ID);
  }
  if (!joined.includes(FUSION_MOCK_TAB_ID)) {
    joined.push(FUSION_MOCK_TAB_ID);
  }
  if (!joined.includes(FUSION_TAB_ID)) {
    joined.push(FUSION_TAB_ID);
  }

  const hasConfigured = joined.some(
    (id) => id !== DEFAULT_STREAM_ID && id !== FUSION_MOCK_TAB_ID && id !== FUSION_TAB_ID
  );
  const configureTabId = hasConfigured ? null : "stream";
  if (configureTabId && !joined.includes(configureTabId)) {
    joined.push(configureTabId);
  }

  return {
    activeTabId: hasConfigured ? loadActiveTabId() : DEFAULT_STREAM_ID,
    joinedStreamIds: joined,
    runningStreams: [],
    configureTabId,
    hasLoadedStreamList: false,
  };
}
