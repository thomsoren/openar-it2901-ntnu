import { ObcNavigationMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-menu/navigation-menu";
import { ObcNavigationItem } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-item/navigation-item";
import { ObcInput } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/input/input";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcTabbedCard } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tabbed-card/tabbed-card";
import type { PageId } from "../../hooks/useNavigation";
import type { StreamSummary } from "../../types/stream";
import { getInputValue } from "../../utils/dom-input";

interface TabChangeDetail {
  tab: number;
}

interface NavigationPanelProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  streamPanelTab: number;
  onStreamPanelTabChange: (tab: number) => void;
  streamSearch: string;
  onStreamSearchChange: (value: string) => void;
  filteredStreams: StreamSummary[];
  streamIdInput: string;
  onStreamIdInputChange: (value: string) => void;
  sourceUrlInput: string;
  onSourceUrlInputChange: (value: string) => void;
  streamActionBusy: boolean;
  streamActionError: string | null;
  onJoinStream: (streamId?: string) => void;
  onCreateStream: () => void;
}

export function NavigationPanel({
  currentPage,
  onNavigate,
  streamPanelTab,
  onStreamPanelTabChange,
  streamSearch,
  onStreamSearchChange,
  filteredStreams,
  streamIdInput,
  onStreamIdInputChange,
  sourceUrlInput,
  onSourceUrlInputChange,
  streamActionBusy,
  streamActionError,
  onJoinStream,
  onCreateStream,
}: NavigationPanelProps) {
  return (
    <ObcNavigationMenu className="navigation-menu">
      <div slot="main">
        <ObcNavigationItem
          label="Fusion"
          checked={currentPage === "fusion"}
          onClick={() => onNavigate("fusion")}
        />
        <ObcNavigationItem
          label="Datavision"
          checked={currentPage === "datavision"}
          onClick={() => onNavigate("datavision")}
        />
        <ObcNavigationItem
          label="AIS"
          checked={currentPage === "ais"}
          onClick={() => onNavigate("ais")}
        />
        <ObcNavigationItem
          label="Components"
          checked={currentPage === "components"}
          onClick={() => onNavigate("components")}
        />
        <ObcNavigationItem
          label="Control Customization"
          checked={currentPage === "control-customization"}
          onClick={() => onNavigate("control-customization")}
        />

        <div className="navigation-stream-panel">
          <div className="navigation-stream-panel__title">Stream Access</div>
          <ObcTabbedCard
            className="navigation-stream-card"
            nTabs={2}
            selectedTab={streamPanelTab}
            onTabChange={(event: CustomEvent<TabChangeDetail>) =>
              onStreamPanelTabChange(event.detail?.tab ?? 0)
            }
          >
            <span slot="tab-title-0">Join</span>
            <span slot="tab-title-1">Create</span>

            <div slot="tab-content-0" className="navigation-stream-controls">
              <div className="navigation-stream-controls__hint">Search Running Streams</div>
              <ObcInput
                value={streamSearch}
                placeholder="Search by stream id"
                aria-label="Search Running Streams"
                onInput={(event: Event) => onStreamSearchChange(getInputValue(event, streamSearch))}
              />
              <div className="navigation-stream-list">
                {filteredStreams.length === 0 && (
                  <div className="navigation-stream-controls__hint">No running streams found.</div>
                )}
                {filteredStreams.map((stream) => (
                  <ObcNavigationItem
                    key={stream.stream_id}
                    label={stream.stream_id}
                    onClick={() => onJoinStream(stream.stream_id)}
                  />
                ))}
              </div>
            </div>

            <div slot="tab-content-1" className="navigation-stream-controls">
              <div className="navigation-stream-controls__hint">Stream ID</div>
              <ObcInput
                value={streamIdInput}
                placeholder="stream"
                aria-label="Stream ID"
                onInput={(event: Event) =>
                  onStreamIdInputChange(getInputValue(event, streamIdInput))
                }
              />
              <div className="navigation-stream-controls__hint">Source URL (optional)</div>
              <ObcInput
                value={sourceUrlInput}
                placeholder="Leave empty to use default video"
                aria-label="Source URL"
                onInput={(event: Event) =>
                  onSourceUrlInputChange(getInputValue(event, sourceUrlInput))
                }
              />
              <ObcButton
                className="navigation-stream-button"
                onClick={onCreateStream}
                disabled={streamActionBusy}
              >
                Create Stream
              </ObcButton>
            </div>
          </ObcTabbedCard>

          {streamActionError && (
            <div className="navigation-stream-controls__error">{streamActionError}</div>
          )}
        </div>
      </div>
    </ObcNavigationMenu>
  );
}
