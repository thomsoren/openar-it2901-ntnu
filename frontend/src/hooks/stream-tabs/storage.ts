import { DEFAULT_STREAM_ID, MOCK_DATA_TAB_ID } from "./constants";

/** Legacy tab IDs — migrate or filter when loading from storage */
const LEGACY_MOCK_DATA_TAB_ID = "fusion-mock";
const REMOVED_FUSION_VIDEO_TAB_ID = "fusion-video";

const ACTIVE_TAB_STORAGE_KEY = "openar.selectedStreamId";
const JOINED_STREAMS_STORAGE_KEY = "openar.joinedStreamIds";

const scopedKey = (base: string, scope?: string): string => {
  const normalized = scope?.trim();
  return normalized ? `${base}:${normalized}` : base;
};

export function loadActiveTabId(scope?: string): string {
  try {
    const scopedStorageKey = scopedKey(ACTIVE_TAB_STORAGE_KEY, scope);
    const scopedStored = localStorage.getItem(scopedStorageKey);
    const id = scopedStored?.trim();
    if (id) {
      if (id === REMOVED_FUSION_VIDEO_TAB_ID) return DEFAULT_STREAM_ID;
      return id === LEGACY_MOCK_DATA_TAB_ID ? MOCK_DATA_TAB_ID : id;
    }

    return DEFAULT_STREAM_ID;
  } catch {
    return DEFAULT_STREAM_ID;
  }
}

export function loadJoinedStreams(scope?: string): string[] {
  const parseJoined = (raw: string | null): string[] => {
    if (!raw) return [DEFAULT_STREAM_ID];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [DEFAULT_STREAM_ID];
    const validIds = parsed
      .filter((item): item is string => typeof item === "string" && !!item)
      .filter((id) => id !== REMOVED_FUSION_VIDEO_TAB_ID)
      .map((id) => (id === LEGACY_MOCK_DATA_TAB_ID ? MOCK_DATA_TAB_ID : id));
    return validIds.length > 0 ? validIds : [DEFAULT_STREAM_ID];
  };

  try {
    const scopedStorageKey = scopedKey(JOINED_STREAMS_STORAGE_KEY, scope);
    const scopedRaw = localStorage.getItem(scopedStorageKey);
    return parseJoined(scopedRaw);
  } catch {
    return [DEFAULT_STREAM_ID];
  }
}

export function persistActiveTabId(activeTabId: string, scope?: string): void {
  try {
    localStorage.setItem(scopedKey(ACTIVE_TAB_STORAGE_KEY, scope), activeTabId);
  } catch {
    // Ignore storage errors
  }
}

export function persistJoinedStreamIds(joinedStreamIds: string[], scope?: string): void {
  try {
    localStorage.setItem(
      scopedKey(JOINED_STREAMS_STORAGE_KEY, scope),
      JSON.stringify(joinedStreamIds)
    );
  } catch {
    // Ignore storage errors
  }
}

export function removePersistedStreamIds(streamIds: string[], scope?: string): void {
  if (streamIds.length === 0) return;

  const normalized = new Set(streamIds.map((id) => id.trim()).filter(Boolean));
  if (normalized.size === 0) return;

  const joined = loadJoinedStreams(scope).filter((id) => !normalized.has(id));
  const nextJoined = joined.length > 0 ? joined : [DEFAULT_STREAM_ID];
  const active = loadActiveTabId(scope);
  const nextActive = normalized.has(active) ? DEFAULT_STREAM_ID : active;

  persistJoinedStreamIds(nextJoined, scope);
  persistActiveTabId(nextActive, scope);
}
