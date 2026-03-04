import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { TabData } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import type { StreamSummary } from "../types/stream";
import { listStreams, toStreamError } from "../services/streams";
import { buildTabsAndActiveStream, hasConfiguredStreams } from "./stream-tabs/derived";
import {
  areStreamsEquivalent,
  setRunningStreamsSnapshot,
  useRunningStreamsSnapshot,
} from "./stream-tabs/running-streams-store";
import {
  useEnsureDefaultStream,
  useExternalStreamSelection,
  usePersistStreamTabs,
  useStreamHeartbeats,
} from "./stream-tabs/effects";
import { initStreamTabState, streamTabReducer } from "./stream-tabs/reducer";
import { FUSION_MOCK_TAB_ID } from "./stream-tabs/constants";
import { useAuth } from "./useAuth";

const WARM_STREAM_CAP = 3;
const KEEP_WARM_SECONDS = 30;

interface TabSelectedDetail {
  tab: TabData;
  id: string;
  index: number;
}

export interface UseStreamTabsOptions {
  externalStreamId?: string | null;
}

export interface UseStreamTabsReturn {
  tabs: TabData[];
  activeTabId: string;
  isTabsHydrated: boolean;
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
  warmStreamIds: string[];
  configureTabId: string | null;
  refreshStreams: () => Promise<void>;
  streamError: string | null;
}

/**
 * @example
 * ```tsx
 * const { tabs, activeTabId, handleTabSelected } = useStreamTabs({
 *   externalStreamId,
 * });
 * ```
 */
export function useStreamTabs(options: UseStreamTabsOptions = {}): UseStreamTabsReturn {
  const { externalStreamId } = options;
  const { session, isSessionPending } = useAuth();
  const storageScope = isSessionPending ? undefined : (session?.user?.id ?? "anon");
  const isScopeReady = !isSessionPending && !!storageScope;

  const [state, dispatch] = useReducer(
    streamTabReducer,
    storageScope ?? "anon",
    initStreamTabState
  );
  const { activeTabId, joinedStreamIds, runningStreams, configureTabId, hydratedScope } = state;
  const sharedRunningStreams = useRunningStreamsSnapshot();

  const [streamError, setStreamError] = useState<string | null>(null);

  const activeIsSetup = configureTabId === activeTabId;
  const isTabsHydrated = isScopeReady && hydratedScope === storageScope;
  const wsEnabled = isTabsHydrated && !activeIsSetup;

  const hasConfigured = hasConfiguredStreams(joinedStreamIds, configureTabId);
  const showAddButton = hasConfigured;
  const showCloseButtons = hasConfigured;
  const warmStreamIds = useMemo(() => {
    const ordered = [activeTabId, ...joinedStreamIds];
    const seen = new Set<string>();
    const selected: string[] = [];
    for (const streamId of ordered) {
      if (
        !streamId ||
        seen.has(streamId) ||
        streamId === configureTabId ||
        streamId === FUSION_MOCK_TAB_ID
      ) {
        continue;
      }
      seen.add(streamId);
      selected.push(streamId);
      if (selected.length >= WARM_STREAM_CAP) {
        break;
      }
    }
    return selected;
  }, [activeTabId, configureTabId, joinedStreamIds]);

  const { tabs, activeStream } = useMemo(
    () => buildTabsAndActiveStream(joinedStreamIds, runningStreams, configureTabId, activeTabId),
    [joinedStreamIds, runningStreams, configureTabId, activeTabId]
  );

  useEffect(() => {
    if (!areStreamsEquivalent(sharedRunningStreams, runningStreams)) {
      dispatch({ type: "SET_RUNNING_STREAMS", streams: sharedRunningStreams });
    }
  }, [runningStreams, sharedRunningStreams]);

  const refreshStreams = useCallback(async () => {
    try {
      const streams = await listStreams();
      setRunningStreamsSnapshot(streams);
    } catch (err) {
      setStreamError(toStreamError(err, "Failed to load streams"));
    }
  }, []);

  useEnsureDefaultStream({ dispatch, setStreamError });
  useStreamHeartbeats(warmStreamIds, KEEP_WARM_SECONDS);
  const canPersistScope = isScopeReady && hydratedScope === storageScope;
  usePersistStreamTabs(activeTabId, joinedStreamIds, storageScope, canPersistScope);
  useExternalStreamSelection(externalStreamId, { dispatch, setStreamError });

  useEffect(() => {
    if (!isScopeReady) return;
    dispatch({ type: "RESET_FROM_STORAGE", state: initStreamTabState(storageScope) });
  }, [storageScope, isScopeReady]);

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
      refreshStreams().catch((err) => console.warn("stream refresh failed", err));
    },
    [refreshStreams]
  );

  return {
    tabs,
    activeTabId,
    isTabsHydrated,
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
    warmStreamIds,
    configureTabId,
    refreshStreams,
    streamError,
  };
}
