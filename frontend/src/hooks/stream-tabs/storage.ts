const ACTIVE_TAB_STORAGE_KEY = "openar.selectedStreamId";
const JOINED_STREAMS_STORAGE_KEY = "openar.joinedStreamIds";

export function loadActiveTabId(): string {
  try {
    const stored = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return stored?.trim() || "default";
  } catch {
    return "default";
  }
}

export function loadJoinedStreams(): string[] {
  try {
    const raw = localStorage.getItem(JOINED_STREAMS_STORAGE_KEY);
    if (!raw) return ["default"];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return ["default"];
    return parsed as string[];
  } catch {
    return ["default"];
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
