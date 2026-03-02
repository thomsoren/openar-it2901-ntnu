import { useEffect, useRef, useState } from "react";
import { ObcTabRow } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import type { TabData } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import { ARControlPanel } from "../ar-control-panel/ARControlPanel";

interface StreamWorkspaceHeaderProps {
  tabs: TabData[];
  activeTabId: string;
  showAddButton: boolean;
  showCloseButtons: boolean;
  onTabSelected: (event: CustomEvent<{ tab: TabData; id: string; index: number }>) => void;
  onTabClosed: (event: CustomEvent<{ id?: string }>) => void;
  onAddTab: () => void;
}

export function StreamWorkspaceHeader({
  tabs,
  activeTabId,
  showAddButton,
  showCloseButtons,
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
      const shellWidth = shell.clientWidth;
      const previousTabRow = {
        flex: tabRow.style.flex,
        minWidth: tabRow.style.minWidth,
        width: tabRow.style.width,
      };
      const previousControls = {
        flex: controls.style.flex,
        minWidth: controls.style.minWidth,
        width: controls.style.width,
      };

      tabRow.style.flex = "0 0 auto";
      tabRow.style.minWidth = "0";
      tabRow.style.width = "max-content";

      controls.style.flex = "0 0 auto";
      controls.style.minWidth = "0";
      controls.style.width = "max-content";

      const tabsWidth = Math.ceil(tabRow.getBoundingClientRect().width);
      const controlsWidth = Math.ceil(controls.getBoundingClientRect().width);
      const gap = parseFloat(getComputedStyle(shell).columnGap || "0");

      tabRow.style.flex = previousTabRow.flex;
      tabRow.style.minWidth = previousTabRow.minWidth;
      tabRow.style.width = previousTabRow.width;

      controls.style.flex = previousControls.flex;
      controls.style.minWidth = previousControls.minWidth;
      controls.style.width = previousControls.width;

      setShouldStackTabsBar(shellWidth > 0 && tabsWidth + controlsWidth + gap > shellWidth);
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
  }, [tabs, activeTabId, showAddButton, showCloseButtons]);

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
        />
      </div>
      <div ref={controlsRef} className="stream-tabs-controls">
        <ARControlPanel />
      </div>
    </div>
  );
}
