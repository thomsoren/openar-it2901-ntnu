import { useSyncExternalStore } from "react";
import type { StreamSummary } from "../../types/stream";

function arePlaybackUrlsEqual(
  previous: StreamSummary["playback_urls"],
  next: StreamSummary["playback_urls"]
): boolean {
  if (!previous && !next) return true;
  if (!previous || !next) return false;
  return (
    previous.whep_url === next.whep_url &&
    previous.hls_url === next.hls_url &&
    previous.rtsp_url === next.rtsp_url &&
    previous.hls_s3_url === next.hls_s3_url
  );
}

export function areStreamsEquivalent(previous: StreamSummary[], next: StreamSummary[]): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;

  const byId = new Map(previous.map((stream) => [stream.stream_id, stream] as const));

  for (const stream of next) {
    const prev = byId.get(stream.stream_id);
    if (!prev) return false;
    if (
      prev.status !== stream.status ||
      prev.pid !== stream.pid ||
      prev.restart_count !== stream.restart_count ||
      prev.source_url !== stream.source_url ||
      !arePlaybackUrlsEqual(prev.playback_urls, stream.playback_urls)
    ) {
      return false;
    }
  }

  return true;
}

let runningStreamsSnapshot: StreamSummary[] = [];
const listeners = new Set<() => void>();

function subscribeRunningStreams(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRunningStreamsSnapshot(): StreamSummary[] {
  return runningStreamsSnapshot;
}

export function setRunningStreamsSnapshot(streams: StreamSummary[]): void {
  if (areStreamsEquivalent(runningStreamsSnapshot, streams)) {
    return;
  }

  runningStreamsSnapshot = streams;
  listeners.forEach((listener) => listener());
}

export function useRunningStreamsSnapshot(): StreamSummary[] {
  return useSyncExternalStore(
    subscribeRunningStreams,
    getRunningStreamsSnapshot,
    getRunningStreamsSnapshot
  );
}
