import { useCallback, useEffect, useRef, useState } from "react";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/openbridge.css";
import { ObcBrillianceMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/brilliance-menu/brilliance-menu";
import "./App.css";
import Ais from "./pages/Ais";
import Fusion from "./pages/Fusion";
import Components from "./pages/Components";
import Datavision from "./pages/Datavision";
import { useClock } from "./hooks/useClock";
import { useNavigation } from "./hooks/useNavigation";
import { useStreamAccessPanel } from "./hooks/useStreamAccessPanel";
import { toStreamError } from "./services/streams";
import { AppTopBar } from "./components/app/AppTopBar";
import { NavigationPanel } from "./components/app/NavigationPanel";
import { UserPanel } from "./components/app/UserPanel";

const handleBrillianceChange = (event: CustomEvent) => {
  document.documentElement.setAttribute("data-obc-theme", event.detail.value);
};

function App() {
  const { clockDate } = useClock();
  const nav = useNavigation();

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

  // When user selects a stream from the nav menu, pass it to Datavision via prop
  const [externalStreamId, setExternalStreamId] = useState<string | null>(null);

  const selectStream = useCallback(
    (streamId: string) => {
      setExternalStreamId(streamId);
      nav.handleNavigationItemClick("datavision");
    },
    [nav]
  );

  const streamAccess = useStreamAccessPanel({ onStreamSelected: selectStream });
  const {
    streamPanelTab,
    setStreamPanelTab,
    streamSearch,
    setStreamSearch,
    filteredStreams,
    streamIdInput,
    setStreamIdInput,
    sourceUrlInput,
    setSourceUrlInput,
    streamActionBusy,
    streamActionError,
    setStreamActionError,
    loadStreams,
    joinStream,
    createStream,
  } = streamAccess;

  const renderPublicPage = () => {
    switch (nav.currentPage) {
      case "ais":
        return <Ais />;
      case "components":
        return <Components />;
      case "fusion":
        return <Fusion />;
      case "datavision":
      default:
        return (
          <Datavision
            externalStreamId={externalStreamId}
            onAuthGateVisibleChange={handleAuthGateVisibleChange}
          />
        );
    }
  };

  // Refresh stream list when nav menu opens
  useEffect(() => {
    if (!nav.showNavigationMenu) {
      return;
    }
    loadStreams().catch((err) => {
      setStreamActionError(toStreamError(err, "Failed to load streams"));
    });
  }, [loadStreams, nav.showNavigationMenu, setStreamActionError]);

  const handleNavigationMenuToggle = () => {
    nav.setShowNavigationMenu((previous) => !previous);
  };

  const handleBrillianceToggle = () => {
    nav.setShowUserPanel(false);
    nav.setShowBrillianceMenu((previous) => !previous);
  };

  const handleUserPanelToggle = () => {
    if (isOnAuthGate) {
      return;
    }
    nav.setShowBrillianceMenu(false);
    nav.setShowUserPanel((previous) => !previous);
  };

  const handleUserAuthenticated = async () => {
    nav.setShowUserPanel(false);
  };

  return (
    <>
      <AppTopBar
        pageLabel={nav.pageLabels[nav.currentPage]}
        clockDate={clockDate}
        isOnAuthGate={isOnAuthGate}
        showNavigationMenu={nav.showNavigationMenu}
        showUserPanel={nav.showUserPanel}
        onToggleNavigationMenu={handleNavigationMenuToggle}
        onToggleBrillianceMenu={handleBrillianceToggle}
        onToggleUserPanel={handleUserPanelToggle}
      />

      {nav.showUserPanel && (
        <div ref={userPanelRef}>
          <UserPanel onSignedIn={handleUserAuthenticated} />
        </div>
      )}

      {nav.showNavigationMenu && (
        <NavigationPanel
          currentPage={nav.currentPage}
          onNavigate={nav.handleNavigationItemClick}
          streamPanelTab={streamPanelTab}
          onStreamPanelTabChange={setStreamPanelTab}
          streamSearch={streamSearch}
          onStreamSearchChange={setStreamSearch}
          filteredStreams={filteredStreams}
          streamIdInput={streamIdInput}
          onStreamIdInputChange={setStreamIdInput}
          sourceUrlInput={sourceUrlInput}
          onSourceUrlInputChange={setSourceUrlInput}
          streamActionBusy={streamActionBusy}
          streamActionError={streamActionError}
          onJoinStream={(streamId) => {
            void joinStream(streamId);
          }}
          onCreateStream={() => {
            void createStream();
          }}
        />
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
