import { useEffect, useRef, useState } from "react";
import { ObcTabRow } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import type { TabData } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import { ObiCameraOff } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-camera-off";
import { ObiCamera } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-camera";
import { ObiMediaLive } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-media-live";
import { ObiUpIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-up-iec";
import type { StreamSummary } from "../../types/stream";
import { MOCK_DATA_TAB_ID } from "../../hooks/stream-tabs/constants";
import { ARControlPanel } from "../ar-control-panel/ARControlPanel";

function isLiveSourceUrl(sourceUrl: string): boolean {
  try {
    const scheme = new URL(sourceUrl).protocol.replace(":", "").toLowerCase();
    return ["rtsp", "rtsps", "rtmp", "udp", "tcp"].includes(scheme);
  } catch {
    return false;
  }
}

function tabIcon(tabId: string, runningStreams: StreamSummary[], configureTabId: string | null) {
  if (tabId === configureTabId) return <ObiUpIec />;
  if (tabId === MOCK_DATA_TAB_ID) return <ObiCamera />;
  const stream = runningStreams.find((s) => s.stream_id === tabId);
  if (!stream) return <ObiCameraOff />;
  if (isLiveSourceUrl(stream.source_url)) return <ObiMediaLive />;
  return <ObiCamera />;
}

interface StreamWorkspaceHeaderProps {
  tabs: TabData[];
  activeTabId: string;
  showAddButton: boolean;
  showCloseButtons: boolean;
  runningStreams: StreamSummary[];
  configureTabId: string | null;
  onTabSelected: (event: CustomEvent<{ tab: TabData; id: string; index: number }>) => void;
  onTabClosed: (event: CustomEvent<{ id?: string }>) => void;
  onAddTab: () => void;
}

export function StreamWorkspaceHeader({
  tabs,
  activeTabId,
  showAddButton,
  showCloseButtons,
  runningStreams,
  configureTabId,
  onTabSelected,
  onTabClosed,
  onAddTab,
}: StreamWorkspaceHeaderProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const tabRowRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [shouldStackTabsBar, setShouldStackTabsBar] = useState(false);

  useEffect(() => {
    const shell = shellRef.current;
    const tabRow = tabRowRef.current;
    const controls = controlsRef.current;
    if (!shell || !tabRow || !controls) return;

    let frame = 0;

    const computeLayout = () => {
      const wasStacked = shell.classList.contains("stream-tabs-bar--stacked");
      if (wasStacked) shell.classList.remove("stream-tabs-bar--stacked");

      const shellWidth = shell.clientWidth;
      const tabsWidth = tabRow.scrollWidth;
      const controlsWidth = controls.scrollWidth;
      const gap = parseFloat(getComputedStyle(shell).columnGap || "0");
      const shouldStack = shellWidth > 0 && tabsWidth + controlsWidth + gap > shellWidth;

      if (wasStacked && shouldStack) shell.classList.add("stream-tabs-bar--stacked");

      setShouldStackTabsBar(shouldStack);
    };

    const scheduleLayout = () => {
      cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(computeLayout);
    };

    scheduleLayout();

    const observer = new ResizeObserver(scheduleLayout);
    observer.observe(shell);
    observer.observe(tabRow);
    observer.observe(controls);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={shellRef}
      className={`stream-tabs-bar${shouldStackTabsBar ? " stream-tabs-bar--stacked" : ""}`}
    >
      <div ref={tabRowRef} className="stream-tab-row">
        <ObcTabRow
          tabs={tabs}
          selectedTabId={activeTabId}
          hasAddNewTab={showAddButton}
          hasClose={showCloseButtons}
          onTabSelected={onTabSelected}
          onTabClosed={onTabClosed}
          onAddNewTab={onAddTab}
        >
          {tabs.map((tab) => (
            <span key={tab.id} slot={`tab-${tab.id}-icon`}>
              {tabIcon(tab.id, runningStreams, configureTabId)}
            </span>
          ))}
        </ObcTabRow>
      </div>
      <div ref={controlsRef} className="stream-tabs-controls">
        <ARControlPanel />
      </div>
    </div>
  );
}
