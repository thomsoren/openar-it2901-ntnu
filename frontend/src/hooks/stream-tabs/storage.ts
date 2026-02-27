import { DEFAULT_STREAM_ID } from "./constants";

const ACTIVE_TAB_STORAGE_KEY = "openar.selectedStreamId";
const JOINED_STREAMS_STORAGE_KEY = "openar.joinedStreamIds";

export function loadActiveTabId(): string {
  try {
    const stored = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return stored?.trim() || DEFAULT_STREAM_ID;
  } catch {
    return DEFAULT_STREAM_ID;
  }
}

export function loadJoinedStreams(): string[] {
  try {
    const raw = localStorage.getItem(JOINED_STREAMS_STORAGE_KEY);
    if (!raw) return [DEFAULT_STREAM_ID];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [DEFAULT_STREAM_ID];
    const validIds = parsed.filter((item): item is string => typeof item === "string" && !!item);
    return validIds.length > 0 ? validIds : [DEFAULT_STREAM_ID];
  } catch {
    return [DEFAULT_STREAM_ID];
  }
}

export function persistActiveTabId(activeTabId: string): void {
  try {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTabId);
  } catch {
    // Ignore storage errors
  }
}

export function persistJoinedStreamIds(joinedStreamIds: string[]): void {
  try {
    localStorage.setItem(JOINED_STREAMS_STORAGE_KEY, JSON.stringify(joinedStreamIds));
  } catch {
    // Ignore storage errors
  }
}
