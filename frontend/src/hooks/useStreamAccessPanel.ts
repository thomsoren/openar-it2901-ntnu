import { useCallback, useMemo, useState } from "react";
import type { StreamSummary } from "../types/stream";
import { listStreams, startStream, toStreamError } from "../services/streams";

interface UseStreamAccessPanelOptions {
  onStreamSelected: (streamId: string) => void;
}

export interface UseStreamAccessPanelResult {
  streamIdInput: string;
  sourceUrlInput: string;
  streamSearch: string;
  runningStreams: StreamSummary[];
  streamPanelTab: number;
  streamActionError: string | null;
  streamActionBusy: boolean;
  filteredStreams: StreamSummary[];
  setStreamIdInput: (value: string) => void;
  setSourceUrlInput: (value: string) => void;
  setStreamSearch: (value: string) => void;
  setStreamPanelTab: (value: number) => void;
  setStreamActionError: (value: string | null) => void;
  loadStreams: () => Promise<StreamSummary[]>;
  joinStream: (streamId?: string) => Promise<void>;
  createStream: () => Promise<void>;
}

export function useStreamAccessPanel({ onStreamSelected }: UseStreamAccessPanelOptions) {
  const [streamIdInput, setStreamIdInput] = useState("stream");
  const [sourceUrlInput, setSourceUrlInput] = useState("");
  const [streamSearch, setStreamSearch] = useState("");
  const [runningStreams, setRunningStreams] = useState<StreamSummary[]>([]);
  const [streamPanelTab, setStreamPanelTab] = useState(0);
  const [streamActionError, setStreamActionError] = useState<string | null>(null);
  const [streamActionBusy, setStreamActionBusy] = useState(false);

  const loadStreams = useCallback(async (): Promise<StreamSummary[]> => {
    const streams = await listStreams();
    setRunningStreams(streams);
    return streams;
  }, []);

  const joinStream = useCallback(
    async (streamIdFromList?: string) => {
      const streamId = (streamIdFromList ?? streamIdInput).trim();
      if (!streamId) {
        setStreamActionError("Stream ID is required");
        return;
      }

      setStreamActionBusy(true);
      setStreamActionError(null);

      try {
        const streams = await loadStreams();
        const exists = streams.some((stream) => stream.stream_id === streamId);
        if (!exists) {
          throw new Error(`Stream '${streamId}' is not running`);
        }
        onStreamSelected(streamId);
      } catch (err) {
        setStreamActionError(toStreamError(err, "Failed to join stream"));
      } finally {
        setStreamActionBusy(false);
      }
    },
    [loadStreams, onStreamSelected, streamIdInput]
  );

  const createStream = useCallback(async () => {
    const streamId = streamIdInput.trim();
    const sourceReference = sourceUrlInput.trim();

    if (!streamId) {
      setStreamActionError("Stream ID is required");
      return;
    }

    setStreamActionBusy(true);
    setStreamActionError(null);

    try {
      await startStream(streamId, {
        sourceUrl: sourceReference || undefined,
        loop: true,
        allowExisting: false,
      });
      setSourceUrlInput("");
      await loadStreams();
      onStreamSelected(streamId);
    } catch (err) {
      setStreamActionError(toStreamError(err, "Failed to create stream"));
    } finally {
      setStreamActionBusy(false);
    }
  }, [loadStreams, onStreamSelected, sourceUrlInput, streamIdInput]);

  const filteredStreams = useMemo(() => {
    const query = streamSearch.trim().toLowerCase();
    if (!query) {
      return runningStreams;
    }

    return runningStreams.filter((stream) => stream.stream_id.toLowerCase().includes(query));
  }, [runningStreams, streamSearch]);

  return {
    streamIdInput,
    sourceUrlInput,
    streamSearch,
    runningStreams,
    streamPanelTab,
    streamActionError,
    streamActionBusy,
    filteredStreams,
    setStreamIdInput,
    setSourceUrlInput,
    setStreamSearch,
    setStreamPanelTab,
    setStreamActionError,
    loadStreams,
    joinStream,
    createStream,
  } satisfies UseStreamAccessPanelResult;
}
