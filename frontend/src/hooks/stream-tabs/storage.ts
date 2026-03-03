import { DEFAULT_STREAM_ID } from "./constants";

const ACTIVE_TAB_STORAGE_KEY = "openar.selectedStreamId";
const JOINED_STREAMS_STORAGE_KEY = "openar.joinedStreamIds";
const ANON_SCOPE = "anon";

const scopedKey = (base: string, scope?: string): string => {
  const normalized = scope?.trim();
  return normalized ? `${base}:${normalized}` : base;
};

export function loadActiveTabId(scope?: string): string {
  try {
    const scopedStorageKey = scopedKey(ACTIVE_TAB_STORAGE_KEY, scope);
    const scopedStored = localStorage.getItem(scopedStorageKey);
    if (scopedStored?.trim()) return scopedStored.trim();

    if (scope?.trim()) {
      const anonStored = localStorage.getItem(scopedKey(ACTIVE_TAB_STORAGE_KEY, ANON_SCOPE));
      if (anonStored?.trim()) {
        localStorage.setItem(scopedStorageKey, anonStored);
        return anonStored.trim();
      }

      const legacyStored = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
      if (legacyStored?.trim()) {
        localStorage.setItem(scopedStorageKey, legacyStored);
        localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
        return legacyStored.trim();
      }
      return DEFAULT_STREAM_ID;
    }

    const stored = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return stored?.trim() || DEFAULT_STREAM_ID;
  } catch {
    return DEFAULT_STREAM_ID;
  }
}

export function loadJoinedStreams(scope?: string): string[] {
  const parseJoined = (raw: string | null): string[] => {
    if (!raw) return [DEFAULT_STREAM_ID];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [DEFAULT_STREAM_ID];
    const validIds = parsed.filter((item): item is string => typeof item === "string" && !!item);
    return validIds.length > 0 ? validIds : [DEFAULT_STREAM_ID];
  };

  try {
    const scopedStorageKey = scopedKey(JOINED_STREAMS_STORAGE_KEY, scope);
    const scopedRaw = localStorage.getItem(scopedStorageKey);
    if (scopedRaw) {
      return parseJoined(scopedRaw);
    }

    let raw: string | null = null;
    if (scope?.trim()) {
      const anonRaw = localStorage.getItem(scopedKey(JOINED_STREAMS_STORAGE_KEY, ANON_SCOPE));
      if (anonRaw) {
        localStorage.setItem(scopedStorageKey, anonRaw);
        return parseJoined(anonRaw);
      }

      const legacyRaw = localStorage.getItem(JOINED_STREAMS_STORAGE_KEY);
      if (legacyRaw) {
        raw = legacyRaw;
        localStorage.setItem(scopedStorageKey, raw);
        localStorage.removeItem(JOINED_STREAMS_STORAGE_KEY);
      }
    } else {
      raw = localStorage.getItem(JOINED_STREAMS_STORAGE_KEY);
    }
    return parseJoined(raw);
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
