import { useEffect, useRef } from "react";
import {
  ensureDefaultStreamRunning,
  listStreams,
  sendStreamHeartbeat,
  toStreamError,
} from "../../services/streams";
import { persistActiveTabId, persistJoinedStreamIds } from "./storage";
import { setRunningStreamsSnapshot } from "./running-streams-store";
import type { StreamTabAction } from "./reducer";
import { FUSION_MOCK_TAB_ID } from "./constants";

interface EffectOptions {
  dispatch: (action: StreamTabAction) => void;
  setStreamError: (value: string | null) => void;
}

export function useEnsureDefaultStream({ dispatch, setStreamError }: EffectOptions): void {
  useEffect(() => {
    const ensureDefaultStream = async () => {
      try {
        const streams = await ensureDefaultStreamRunning();
        setRunningStreamsSnapshot(streams);
        dispatch({ type: "SET_RUNNING_STREAMS", streams });
      } catch (err) {
        setStreamError(toStreamError(err, "Failed to initialize streams"));
      }
    };
    void ensureDefaultStream();
  }, [dispatch, setStreamError]);
}

export function useStreamHeartbeats(
  joinedStreamIds: string[],
  configureTabId: string | null
): void {
  const joinedIdsRef = useRef(joinedStreamIds);
  const configureTabIdRef = useRef(configureTabId);

  useEffect(() => {
    joinedIdsRef.current = joinedStreamIds;
    configureTabIdRef.current = configureTabId;
  }, [joinedStreamIds, configureTabId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      for (const id of joinedIdsRef.current) {
        if (id === configureTabIdRef.current || id === FUSION_MOCK_TAB_ID) continue;
        sendStreamHeartbeat(id).catch((err) => console.warn("stream heartbeat failed", err));
      }
    }, 60_000);

    return () => window.clearInterval(interval);
  }, []);
}

export function usePersistStreamTabs(
  activeTabId: string,
  joinedStreamIds: string[],
  storageScope?: string,
  enabled = true
): void {
  useEffect(() => {
    if (!enabled) return;
    persistActiveTabId(activeTabId, storageScope);
  }, [activeTabId, storageScope, enabled]);

  useEffect(() => {
    if (!enabled) return;
    persistJoinedStreamIds(joinedStreamIds, storageScope);
  }, [joinedStreamIds, storageScope, enabled]);
}

export function useExternalStreamSelection(
  externalStreamId: string | null | undefined,
  { dispatch, setStreamError }: EffectOptions
): void {
  const prevExternalStreamIdRef = useRef(externalStreamId);

  useEffect(() => {
    if (externalStreamId && externalStreamId !== prevExternalStreamIdRef.current) {
      let cancelled = false;

      const syncExternalStreamState = async () => {
        try {
          const streams = await listStreams();
          const exists = streams.some((stream) => stream.stream_id === externalStreamId);
          if (!cancelled) {
            if (!exists) {
              setStreamError(`Stream '${externalStreamId}' is not running`);
              return;
            }
            setRunningStreamsSnapshot(streams);
            dispatch({ type: "JOIN_EXTERNAL_STREAM", streamId: externalStreamId });
            dispatch({ type: "SET_RUNNING_STREAMS", streams });
          }
        } catch (err) {
          if (!cancelled) {
            setStreamError(toStreamError(err, "Failed to refresh streams"));
          }
        }
      };

      void syncExternalStreamState();
      prevExternalStreamIdRef.current = externalStreamId;

      return () => {
        cancelled = true;
      };
    }

    prevExternalStreamIdRef.current = externalStreamId;
  }, [externalStreamId, dispatch, setStreamError]);
}
