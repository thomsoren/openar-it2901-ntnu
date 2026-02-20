import { useCallback, useEffect, useMemo, useState } from "react";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/openbridge.css";
import { ObcTopBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/top-bar/top-bar";
import { ObcBrillianceMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/brilliance-menu/brilliance-menu";
import { ObcClock } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/clock/clock";
import { ObcNavigationMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-menu/navigation-menu";
import { ObcNavigationItem } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-item/navigation-item";
import { ObcUserMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/user-menu/user-menu";
import { ObcTextInputField } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/text-input-field/text-input-field";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcElevatedCard } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/elevated-card/elevated-card";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { ObcElevatedCardSize } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/elevated-card/elevated-card";
import { ObcUserMenuSize } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/user-menu/user-menu";
import { ObcTabbedCard } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tabbed-card/tabbed-card";
import "./App.css";
import Ais from "./pages/Ais";
import Fusion from "./pages/Fusion";
import Components from "./pages/Components";
import Datavision from "./pages/Datavision";
import Settings from "./pages/Settings";
import Upload from "./pages/Upload";
import AuthGate from "./components/auth/AuthGate";
import AccessDenied from "./components/auth/AccessDenied";
import { useClock } from "./hooks/useClock";
import { useNavigation } from "./hooks/useNavigation";
import { useAuth } from "./hooks/useAuth";
import { API_CONFIG } from "./config/video";

const STREAM_SELECTION_STORAGE_KEY = "openar.selectedStreamId";
const JOINED_STREAMS_STORAGE_KEY = "openar.joinedStreamIds";
const STREAM_SELECTION_EVENT = "openar-stream-select";

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

const readJsonSafely = async (
  response: Response
): Promise<{ detail?: string; streams?: StreamSummary[] }> => {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("Backend returned non-JSON response. Check API URL/proxy config.");
  }
  return response.json();
};

const explainFetchError = (err: unknown, fallback: string): string => {
  if (err instanceof TypeError && err.message === "Failed to fetch") {
    return "Failed to fetch. Verify backend URL, network reachability, and CORS origin allowlist.";
  }
  return err instanceof Error ? err.message : fallback;
};

interface StreamSummary {
  stream_id: string;
  status: string;
  pid: number | null;
  restart_count: number;
  source_url: string;
}

interface TabChangeDetail {
  tab: number;
}

function App() {
  const { clockDate } = useClock();
  const nav = useNavigation();
  const auth = useAuth();

  // Stream management state (from main)
  const [streamIdInput, setStreamIdInput] = useState("stream");
  const [sourceUrlInput, setSourceUrlInput] = useState("");
  const [streamSearch, setStreamSearch] = useState("");
  const [runningStreams, setRunningStreams] = useState<StreamSummary[]>([]);
  const [streamPanelTab, setStreamPanelTab] = useState(0);
  const [streamActionError, setStreamActionError] = useState<string | null>(null);
  const [streamActionBusy, setStreamActionBusy] = useState(false);
  const apiBase = API_CONFIG.BASE_URL.replace(/\/$/, "");

  const selectStream = (streamId: string) => {
    try {
      localStorage.setItem(STREAM_SELECTION_STORAGE_KEY, streamId);
    } catch {
      // Ignore storage errors.
    }
    try {
      const raw = localStorage.getItem(JOINED_STREAMS_STORAGE_KEY);
      const existing = raw ? (JSON.parse(raw) as string[]) : [];
      const normalized = Array.from(
        new Set([...existing, streamId].map((id) => id.trim()).filter((id) => id.length > 0))
      );
      localStorage.setItem(JOINED_STREAMS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Ignore storage errors.
    }
    window.dispatchEvent(new CustomEvent(STREAM_SELECTION_EVENT, { detail: { streamId } }));
    nav.handleNavigationItemClick("datavision");
  };

  const loadStreams = useCallback(async (): Promise<StreamSummary[]> => {
    const streamsResponse = await fetch(`${apiBase}/api/streams`);
    const streamsPayload = await readJsonSafely(streamsResponse);
    if (!streamsResponse.ok) {
      throw new Error(streamsPayload.detail || "Failed to load streams");
    }
    const streams = Array.isArray(streamsPayload.streams) ? streamsPayload.streams : [];
    setRunningStreams(streams);
    return streams;
  }, [apiBase]);

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
      const body: { source_url: string; loop: boolean } = {
        source_url: sourceReference,
        loop: true,
      };
      const response = await fetch(`${apiBase}/api/streams/${encodeURIComponent(streamId)}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await readJsonSafely(response);
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
      return <Datavision />;
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

  const renderUploadPage = () => {
    if (!auth.session) {
      return <AuthGate initialMode={nav.authGateMode} onAuthenticated={auth.handleAuthenticated} />;
    }

    if (auth.isSessionPending) {
      return (
        <div className="app-auth-feedback">
          <ObcElevatedCard size={ObcElevatedCardSize.MultiLine}>
            <div slot="label">Checking session</div>
            <div slot="description">Loading authentication state for Upload...</div>
          </ObcElevatedCard>
        </div>
      );
    }

    if (auth.authBridgeStatus === "error") {
      return (
        <div className="app-auth-feedback">
          <ObcElevatedCard size={ObcElevatedCardSize.MultiLine}>
            <div slot="label">Authentication error</div>
            <div slot="description">
              {auth.authBridgeError || "Unable to initialize upload access."}
            </div>
          </ObcElevatedCard>
          <div className="app-auth-feedback__actions">
            <ObcButton variant={ButtonVariant.raised} onClick={auth.retryAuthBridge}>
              Retry
            </ObcButton>
            <ObcButton
              variant={ButtonVariant.flat}
              disabled={auth.isSigningOut}
              onClick={() => void auth.handleSignOut()}
            >
              {auth.isSigningOut ? "Signing out..." : "Sign out"}
            </ObcButton>
          </div>
        </div>
      );
    }

    if (
      auth.authBridgeStatus === "loading" ||
      auth.authBridgeStatus === "idle" ||
      !auth.backendUser
    ) {
      return (
        <div className="app-auth-feedback">
          <ObcElevatedCard size={ObcElevatedCardSize.MultiLine}>
            <div slot="label">Authenticating upload access</div>
            <div slot="description">Establishing API session...</div>
          </ObcElevatedCard>
        </div>
      );
    }

    if (!auth.backendUser.is_admin) {
      return <AccessDenied />;
    }

    return <Upload currentUser={auth.backendUser} />;
  };

  const isOnLoginPage = nav.currentPage === "upload" && !auth.session;

  useEffect(() => {
    const ensureDefaultStream = async () => {
      try {
        let streams = await loadStreams();
        const hasDefault = streams.some((stream) => stream.stream_id === "default");
        if (!hasDefault) {
          const response = await fetch(`${apiBase}/api/streams/default/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ loop: true }),
          });
          if (!response.ok && response.status !== 409) {
            const payload = await readJsonSafely(response);
            throw new Error(payload.detail || "Failed to start default stream");
          }
          streams = await loadStreams();
        }
        try {
          const raw = localStorage.getItem(JOINED_STREAMS_STORAGE_KEY);
          const existing = raw ? (JSON.parse(raw) as string[]) : [];
          const availableIds = new Set(streams.map((stream) => stream.stream_id));
          const normalized = Array.from(
            new Set(
              ["default", ...existing]
                .map((id) => String(id).trim())
                .filter((id) => id.length > 0 && availableIds.has(id))
            )
          );
          localStorage.setItem(JOINED_STREAMS_STORAGE_KEY, JSON.stringify(normalized));
          localStorage.setItem(STREAM_SELECTION_STORAGE_KEY, "default");
        } catch {
          // Ignore storage errors.
        }
      } catch (err) {
        setStreamActionError(explainFetchError(err, "Failed to initialize default stream"));
      }
    };

    ensureDefaultStream();
  }, [apiBase, loadStreams]);

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
          disableUserButton={isOnLoginPage}
          showClock
          menuButtonActivated={nav.showNavigationMenu}
          userButtonActivated={nav.showUserPanel}
          onMenuButtonClicked={() => nav.setShowNavigationMenu((previous) => !previous)}
          onDimmingButtonClicked={() => {
            nav.setShowUserPanel(false);
            nav.setShowBrillianceMenu((previous) => !previous);
          }}
          onUserButtonClicked={() => {
            if (isOnLoginPage) return;
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
        <div className={`user-panel${!auth.session ? " user-panel--auth" : ""}`}>
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
            <ObcNavigationItem
              label="Upload"
              checked={nav.currentPage === "upload"}
              onClick={() => nav.handleNavigationItemClick("upload")}
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
                  <ObcTextInputField
                    label="Search Running Streams"
                    value={streamSearch}
                    hasClearButton
                    placeholder="Search by stream id"
                    onInput={(event) => setStreamSearch(getTextInputValue(event, streamSearch))}
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
                  <ObcTextInputField
                    label="Stream ID"
                    value={streamIdInput}
                    hasClearButton
                    placeholder="stream"
                    onInput={(event) => setStreamIdInput(getTextInputValue(event, streamIdInput))}
                  />
                  <ObcTextInputField
                    label="Source URL (optional)"
                    value={sourceUrlInput}
                    hasClearButton
                    placeholder="Leave empty to use default video"
                    onInput={(event) => setSourceUrlInput(getTextInputValue(event, sourceUrlInput))}
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
          <ObcBrillianceMenu
            onPaletteChanged={handleBrillianceChange}
            show-auto-brightness
            className="brilliance"
          />
        )}

        {nav.currentPage === "upload" ? renderUploadPage() : renderPublicPage()}
      </main>
    </>
  );
}

export default App;
