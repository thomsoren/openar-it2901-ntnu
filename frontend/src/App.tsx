import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/openbridge.css";
import { ObcTopBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/top-bar/top-bar";
import { ObcBrillianceMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/brilliance-menu/brilliance-menu";
import { ObcClock } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/clock/clock";
import { ObcNavigationMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-menu/navigation-menu";
import { ObcNavigationItem } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-item/navigation-item";
import { ObcUserMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/user-menu/user-menu";
import { ObcInput } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/input/input";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcUserMenuSize } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/user-menu/user-menu";
import { ObcTabbedCard } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tabbed-card/tabbed-card";
import "./App.css";
import Ais from "./pages/Ais";
import Fusion from "./pages/Fusion";
import Components from "./pages/Components";
import Datavision from "./pages/Datavision";
import Settings from "./pages/Settings";
import AuthGate from "./components/auth/AuthGate";
import { useClock } from "./hooks/useClock";
import { useNavigation } from "./hooks/useNavigation";
import { useAuth } from "./hooks/useAuth";
import { apiFetch } from "./lib/api-client";
import { readJsonSafely, explainFetchError } from "./utils/api-helpers";
import type { StreamSummary } from "./types/stream";

const handleBrillianceChange = (event: CustomEvent) => {
  document.documentElement.setAttribute("data-obc-theme", event.detail.value);
};

const getTextInputValue = (event: Event, fallback: string): string => {
  const target = event.target as { value?: string } | null;
  if (target && typeof target.value === "string") {
    return target.value;
  }
  return fallback;
};

interface TabChangeDetail {
  tab: number;
}

function App() {
  const { clockDate } = useClock();
  const nav = useNavigation();
  const auth = useAuth();

  const [isOnAuthGate, setIsOnAuthGate] = useState(false);
  const userPanelRef = useRef<HTMLDivElement>(null);
  const brillianceRef = useRef<HTMLDivElement>(null);

  const handleAuthGateVisibleChange = useCallback(
    (visible: boolean) => {
      setIsOnAuthGate(visible);
      if (visible) {
        nav.setShowUserPanel(false);
      }
    },
    [nav]
  );

  // Close user panel and brilliance menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // Check if click is inside the topbar (contains the toggle buttons)
      const topbar = document.querySelector("obc-top-bar");
      if (topbar?.contains(target)) return;

      if (nav.showUserPanel && userPanelRef.current && !userPanelRef.current.contains(target)) {
        nav.setShowUserPanel(false);
      }
      if (
        nav.showBrillianceMenu &&
        brillianceRef.current &&
        !brillianceRef.current.contains(target)
      ) {
        nav.setShowBrillianceMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [nav, nav.showUserPanel, nav.showBrillianceMenu]);

  // Stream management state — local to the nav menu panel
  const [streamIdInput, setStreamIdInput] = useState("stream");
  const [sourceUrlInput, setSourceUrlInput] = useState("");
  const [streamSearch, setStreamSearch] = useState("");
  const [runningStreams, setRunningStreams] = useState<StreamSummary[]>([]);
  const [streamPanelTab, setStreamPanelTab] = useState(0);
  const [streamActionError, setStreamActionError] = useState<string | null>(null);
  const [streamActionBusy, setStreamActionBusy] = useState(false);

  // When user selects a stream from the nav menu, pass it to Datavision via prop
  const [externalStreamId, setExternalStreamId] = useState<string | null>(null);

  const selectStream = (streamId: string) => {
    setExternalStreamId(streamId);
    nav.handleNavigationItemClick("datavision");
  };

  const loadStreams = useCallback(async (): Promise<StreamSummary[]> => {
    const response = await apiFetch("/api/streams");
    const payload = (await readJsonSafely(response)) as {
      detail?: string;
      streams?: StreamSummary[];
    };
    if (!response.ok) {
      throw new Error(payload.detail || "Failed to load streams");
    }
    const streams = Array.isArray(payload.streams) ? payload.streams : [];
    setRunningStreams(streams);
    return streams;
  }, []);

  const handleStreamPanelTabChange = (event: CustomEvent<TabChangeDetail>) => {
    setStreamPanelTab(event.detail?.tab ?? 0);
  };

  const handleJoinStream = async (streamIdFromList?: string) => {
    const streamId = (streamIdFromList ?? streamIdInput).trim();
    if (!streamId) {
      setStreamActionError("Stream ID is required");
      return;
    }

    setStreamActionBusy(true);
    setStreamActionError(null);
    try {
      const streams = await loadStreams();
      const exists = streams.some((stream) => stream.stream_id === streamId);
      if (!exists) {
        throw new Error(`Stream '${streamId}' is not running`);
      }
      selectStream(streamId);
    } catch (err) {
      setStreamActionError(explainFetchError(err, "Failed to join stream"));
    } finally {
      setStreamActionBusy(false);
    }
  };

  const handleCreateStream = async () => {
    const streamId = streamIdInput.trim();
    const sourceReference = sourceUrlInput.trim();
    if (!streamId) {
      setStreamActionError("Stream ID is required");
      return;
    }
    if (!sourceReference) {
      setStreamActionError("Source file is required");
      return;
    }

    setStreamActionBusy(true);
    setStreamActionError(null);
    try {
      const response = await apiFetch(`/api/streams/${encodeURIComponent(streamId)}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_url: sourceReference, loop: true }),
      });
      const payload = (await readJsonSafely(response)) as { detail?: string };
      if (!response.ok) {
        if (response.status === 409) {
          throw new Error(`Stream '${streamId}' is already running. Use a different Stream ID.`);
        }
        throw new Error(payload.detail || "Failed to create stream");
      }

      setSourceUrlInput("");
      await loadStreams();
      selectStream(streamId);
    } catch (err) {
      setStreamActionError(explainFetchError(err, "Failed to create stream"));
    } finally {
      setStreamActionBusy(false);
    }
  };

  const renderPublicPage = () => {
    if (nav.currentPage === "datavision") {
      return (
        <Datavision
          externalStreamId={externalStreamId}
          onAuthGateVisibleChange={handleAuthGateVisibleChange}
        />
      );
    }

    if (nav.currentPage === "ais") {
      return <Ais />;
    }

    if (nav.currentPage === "components") {
      return <Components />;
    }

    if (nav.currentPage === "fusion") {
      return <Fusion />;
    }

    return <Settings />;
  };

  // Refresh stream list when nav menu opens
  useEffect(() => {
    if (!nav.showNavigationMenu) {
      return;
    }
    loadStreams().catch((err) =>
      setStreamActionError(explainFetchError(err, "Failed to load streams"))
    );
  }, [nav.showNavigationMenu, loadStreams]);

  const filteredStreams = useMemo(() => {
    const query = streamSearch.trim().toLowerCase();
    if (!query) {
      return runningStreams;
    }
    return runningStreams.filter((stream) => stream.stream_id.toLowerCase().includes(query));
  }, [runningStreams, streamSearch]);

  return (
    <>
      <header>
        <ObcTopBar
          appTitle="OpenAR"
          pageName={nav.pageLabels[nav.currentPage]}
          showDimmingButton
          showUserButton
          userButtonDisabled={isOnAuthGate}
          showClock
          menuButtonActivated={nav.showNavigationMenu}
          userButtonActivated={nav.showUserPanel}
          onMenuButtonClicked={() => nav.setShowNavigationMenu((previous) => !previous)}
          onDimmingButtonClicked={() => {
            nav.setShowUserPanel(false);
            nav.setShowBrillianceMenu((previous) => !previous);
          }}
          onUserButtonClicked={() => {
            if (isOnAuthGate) return;
            nav.setShowBrillianceMenu(false);
            nav.setShowUserPanel((previous) => !previous);
          }}
        >
          <ObcClock
            slot="clock"
            date={clockDate}
            timeZoneOffsetHours={new Date(clockDate).getTimezoneOffset() / -60}
            showTimezone
            blinkOnlyBreakpointPx={600}
          />
        </ObcTopBar>
      </header>

      {nav.showUserPanel && (
        <div ref={userPanelRef} className={`user-panel${!auth.session ? " user-panel--auth" : ""}`}>
          {auth.session ? (
            <ObcUserMenu
              type={auth.userMenuState}
              size={ObcUserMenuSize.small}
              hasRecentlySignedIn={false}
              userInitials={auth.userInitials}
              userLabel={auth.userLabel}
              signedInActions={auth.signedInActions}
              onSignOutClick={() => void auth.handleSignOut()}
            />
          ) : (
            <AuthGate
              initialMode="login"
              onAuthenticated={async () => {
                nav.setShowUserPanel(false);
                await auth.handleAuthenticated();
              }}
            />
          )}
        </div>
      )}

      {nav.showNavigationMenu && (
        <ObcNavigationMenu className="navigation-menu">
          <div slot="main">
            <ObcNavigationItem
              label="Fusion"
              checked={nav.currentPage === "fusion"}
              onClick={() => nav.handleNavigationItemClick("fusion")}
            />
            <ObcNavigationItem
              label="Datavision"
              checked={nav.currentPage === "datavision"}
              onClick={() => nav.handleNavigationItemClick("datavision")}
            />
            <ObcNavigationItem
              label="AIS"
              checked={nav.currentPage === "ais"}
              onClick={() => nav.handleNavigationItemClick("ais")}
            />
            <ObcNavigationItem
              label="Components"
              checked={nav.currentPage === "components"}
              onClick={() => nav.handleNavigationItemClick("components")}
            />
            <ObcNavigationItem
              label="Settings"
              checked={nav.currentPage === "settings"}
              onClick={() => nav.handleNavigationItemClick("settings")}
            />

            <div className="navigation-stream-panel">
              <div className="navigation-stream-panel__title">Stream Access</div>
              <ObcTabbedCard
                className="navigation-stream-card"
                nTabs={2}
                selectedTab={streamPanelTab}
                onTabChange={handleStreamPanelTabChange}
              >
                <span slot="tab-title-0">Join</span>
                <span slot="tab-title-1">Create</span>

                <div slot="tab-content-0" className="navigation-stream-controls">
                  <div className="navigation-stream-controls__hint">Search Running Streams</div>
                  <ObcInput
                    value={streamSearch}
                    placeholder="Search by stream id"
                    aria-label="Search Running Streams"
                    onInput={(event: Event) =>
                      setStreamSearch(getTextInputValue(event, streamSearch))
                    }
                  />
                  <div className="navigation-stream-list">
                    {filteredStreams.length === 0 && (
                      <div className="navigation-stream-controls__hint">
                        No running streams found.
                      </div>
                    )}
                    {filteredStreams.map((stream) => (
                      <ObcNavigationItem
                        key={stream.stream_id}
                        label={stream.stream_id}
                        onClick={() => handleJoinStream(stream.stream_id)}
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
                      setStreamIdInput(getTextInputValue(event, streamIdInput))
                    }
                  />
                  <div className="navigation-stream-controls__hint">Source URL (optional)</div>
                  <ObcInput
                    value={sourceUrlInput}
                    placeholder="Leave empty to use default video"
                    aria-label="Source URL"
                    onInput={(event: Event) =>
                      setSourceUrlInput(getTextInputValue(event, sourceUrlInput))
                    }
                  />
                  <ObcButton
                    className="navigation-stream-button"
                    onClick={handleCreateStream}
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
      )}

      <main
        className={[
          "main",
          nav.showNavigationMenu ? "main--with-sidebar" : "",
          nav.currentPage === "components" ? "main--no-padding" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {nav.showBrillianceMenu && (
          <div ref={brillianceRef} className="brilliance">
            <ObcBrillianceMenu onPaletteChanged={handleBrillianceChange} show-auto-brightness />
          </div>
        )}

        {renderPublicPage()}
      </main>
    </>
  );
}

export default App;
