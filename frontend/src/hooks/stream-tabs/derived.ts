import type { TabData } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import type { StreamSummary } from "../../types/stream";
import {
  DEFAULT_STREAM_ID,
  DEFAULT_STREAM_TITLE,
  FUSION_TAB_ID,
  FUSION_TAB_TITLE,
  MOCK_DATA_TAB_ID,
  MOCK_DATA_TAB_TITLE,
} from "./constants";

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
  return joinedStreamIds.some(
    (id) =>
      id !== DEFAULT_STREAM_ID &&
      id !== MOCK_DATA_TAB_ID &&
      id !== FUSION_TAB_ID &&
      id !== configureTabId
  );
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

  tabs.push({ id: DEFAULT_STREAM_ID, title: DEFAULT_STREAM_TITLE });
  seen.add(DEFAULT_STREAM_ID);

  for (const id of joinedStreamIds) {
    if (seen.has(id) || id === configureTabId) continue;
    seen.add(id);
    if (id === MOCK_DATA_TAB_ID) {
      tabs.push({ id, title: MOCK_DATA_TAB_TITLE });
      continue;
    }
    if (id === FUSION_TAB_ID) {
      tabs.push({ id, title: FUSION_TAB_TITLE });
      continue;
    }
    const stream = byId.get(id);
    tabs.push({ id, title: stream ? id : `${id} (starting...)` });
  }

  if (configureTabId) {
    tabs.push({ id: configureTabId, title: "Configure" });
  }

  const activeStream = runningStreams.find((s) => s.stream_id === activeTabId) ?? null;
  return { tabs, activeStream };
}
