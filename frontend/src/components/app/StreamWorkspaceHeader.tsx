import { ObcTabRow } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import type { TabData } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import { ARControlPanel } from "../ar-control-panel/ARControlPanel";

interface StreamWorkspaceHeaderProps {
  tabs: TabData[];
  activeTabId: string;
  showAddButton: boolean;
  showCloseButtons: boolean;
  shouldStackTabsBar: boolean;
  onTabSelected: (event: CustomEvent<{ tab: TabData; id: string; index: number }>) => void;
  onTabClosed: (event: CustomEvent<{ id?: string }>) => void;
  onAddTab: () => void;
}

export function StreamWorkspaceHeader({
  tabs,
  activeTabId,
  showAddButton,
  showCloseButtons,
  shouldStackTabsBar,
  onTabSelected,
  onTabClosed,
  onAddTab,
}: StreamWorkspaceHeaderProps) {
  return (
    <div className={`stream-tabs-bar${shouldStackTabsBar ? " stream-tabs-bar--stacked" : ""}`}>
      <ObcTabRow
        className="stream-tab-row"
        tabs={tabs}
        selectedTabId={activeTabId}
        hasAddNewTab={showAddButton}
        hasClose={showCloseButtons}
        onTabSelected={onTabSelected}
        onTabClosed={onTabClosed}
        onAddNewTab={onAddTab}
      />
      <ARControlPanel />
    </div>
  );
}
