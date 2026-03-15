import { ObcDropdownButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/dropdown-button/dropdown-button";
import type { TabData } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tab-row/tab-row";
import type { StreamSummary } from "../../types/stream";
import { ARControlPanel } from "../ar-control-panel/ARControlPanel";

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
  onTabSelected,
}: StreamWorkspaceHeaderProps) {
  const options = tabs.map((t) => ({ value: t.id, label: t.title }));

  const handleChange = (event: CustomEvent<{ value: string }>) => {
    const tab = tabs.find((t) => t.id === event.detail.value);
    if (!tab) return;
    const customEvent = new CustomEvent("tab-selected", {
      detail: { tab, id: tab.id, index: tabs.indexOf(tab) },
    }) as CustomEvent<{ tab: TabData; id: string; index: number }>;
    onTabSelected(customEvent);
  };

  return (
    <div className="stream-tabs-bar">
      <div className="obc-component-size-regular">
        <ObcDropdownButton
          title="Stream"
          options={options}
          value={activeTabId}
          onChange={handleChange}
        />
      </div>

      <div className="stream-tabs-divider" />

      <ARControlPanel />
    </div>
  );
}
