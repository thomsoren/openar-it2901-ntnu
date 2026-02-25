import { useEffect, useRef } from "react";
import {
  ensureDefaultStreamRunning,
  listStreams,
  sendStreamHeartbeat,
  toStreamError,
} from "../../services/streams";
import { persistActiveTabId, persistJoinedStreamIds } from "./storage";
import type { StreamTabAction } from "./reducer";

interface EffectOptions {
  dispatch: (action: StreamTabAction) => void;
  setStreamError: (value: string | null) => void;
}

export function useEnsureDefaultStream({ dispatch, setStreamError }: EffectOptions): void {
  useEffect(() => {
    const ensureDefaultStream = async () => {
      try {
        const streams = await ensureDefaultStreamRunning();
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
        if (id === configureTabIdRef.current) continue;
        sendStreamHeartbeat(id).catch((err) => console.warn("stream heartbeat failed", err));
      }
    }, 60_000);

    return () => window.clearInterval(interval);
  }, []);
}

export function usePersistStreamTabs(activeTabId: string, joinedStreamIds: string[]): void {
  useEffect(() => {
    persistActiveTabId(activeTabId);
  }, [activeTabId]);

  useEffect(() => {
    persistJoinedStreamIds(joinedStreamIds);
  }, [joinedStreamIds]);
}

export function useExternalStreamSelection(
  externalStreamId: string | null | undefined,
  { dispatch, setStreamError }: EffectOptions
): void {
  const prevExternalStreamIdRef = useRef(externalStreamId);

  useEffect(() => {
    if (externalStreamId && externalStreamId !== prevExternalStreamIdRef.current) {
      dispatch({ type: "JOIN_EXTERNAL_STREAM", streamId: externalStreamId });
      let cancelled = false;

      const syncExternalStreamState = async () => {
        try {
          const streams = await listStreams();
          if (!cancelled) {
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
