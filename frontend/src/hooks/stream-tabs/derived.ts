import type { TabData } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import type { StreamSummary } from "../../types/stream";

export function nextAvailableStreamId(
  runningStreams: StreamSummary[],
  joinedStreamIds: string[]
): string {
  const existing = new Set([...runningStreams.map((s) => s.stream_id), ...joinedStreamIds]);
  let index = 1;
  let candidate = "stream";
  while (existing.has(candidate)) {
    index += 1;
    candidate = `stream-${index}`;
  }
  return candidate;
}

export function hasConfiguredStreams(
  joinedStreamIds: string[],
  configureTabId: string | null
): boolean {
  return joinedStreamIds.some((id) => id !== "default" && id !== configureTabId);
}

export function buildTabsAndActiveStream(
  joinedStreamIds: string[],
  runningStreams: StreamSummary[],
  configureTabId: string | null,
  activeTabId: string
): { tabs: TabData[]; activeStream: StreamSummary | null } {
  const byId = new Map(runningStreams.map((s) => [s.stream_id, s] as const));
  const tabs: TabData[] = [];
  const seen = new Set<string>();

  tabs.push({ id: "default", title: "Example" });
  seen.add("default");

  for (const id of joinedStreamIds) {
    if (seen.has(id) || id === configureTabId) continue;
    seen.add(id);
    const stream = byId.get(id);
    tabs.push({ id, title: stream ? id : `${id} (starting...)` });
  }

  if (configureTabId) {
    tabs.push({ id: configureTabId, title: "Configure" });
  }

  const activeStream = runningStreams.find((s) => s.stream_id === activeTabId) ?? null;
  return { tabs, activeStream };
}
