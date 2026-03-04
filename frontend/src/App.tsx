import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/openbridge.css";
import { ObcBrillianceMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/brilliance-menu/brilliance-menu";
import "./App.css";
import Ais from "./pages/Ais";
import Fusion from "./pages/Fusion";
import Components from "./pages/Components";
import Datavision from "./pages/Datavision";
import ControlCustomization from "./pages/ControlCustomization";
import MediaLibrary from "./pages/MediaLibrary";
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
  const {
    currentPage,
    pageLabels,
    showNavigationMenu,
    showUserPanel,
    showBrillianceMenu,
    setShowNavigationMenu,
    setShowUserPanel,
    setShowBrillianceMenu,
    handleNavigationItemClick,
  } = nav;

  const [isOnAuthGate, setIsOnAuthGate] = useState(false);
  const userPanelRef = useRef<HTMLDivElement>(null);
  const brillianceRef = useRef<HTMLDivElement>(null);

  const handleAuthGateVisibleChange = useCallback(
    (visible: boolean) => {
      setIsOnAuthGate(visible);
      if (visible) {
        setShowUserPanel(false);
      }
    },
    [setShowUserPanel]
  );

  // Close user panel and brilliance menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // Check if click is inside the topbar (contains the toggle buttons)
      const topbar = document.querySelector("obc-top-bar");
      if (topbar?.contains(target)) return;

      if (showUserPanel && userPanelRef.current && !userPanelRef.current.contains(target)) {
        setShowUserPanel(false);
      }
      if (showBrillianceMenu && brillianceRef.current && !brillianceRef.current.contains(target)) {
        setShowBrillianceMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [setShowBrillianceMenu, setShowUserPanel, showBrillianceMenu, showUserPanel]);

  // When user selects a stream from the nav menu, pass it to Datavision via prop
  const [externalStreamId, setExternalStreamId] = useState<string | null>(null);

  const selectStream = useCallback(
    (streamId: string) => {
      setExternalStreamId(streamId);
      handleNavigationItemClick("datavision");
    },
    [handleNavigationItemClick]
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

  // Refresh stream list when nav menu opens
  useEffect(() => {
    if (!showNavigationMenu) {
      return;
    }
    loadStreams().catch((err) => {
      setStreamActionError(toStreamError(err, "Failed to load streams"));
    });
  }, [loadStreams, setStreamActionError, showNavigationMenu]);

  const handleNavigationMenuToggle = () => {
    setShowNavigationMenu((previous) => !previous);
  };

  const handleBrillianceToggle = () => {
    setShowUserPanel(false);
    setShowBrillianceMenu((previous) => !previous);
  };

  const handleUserPanelToggle = () => {
    if (isOnAuthGate) {
      return;
    }
    setShowBrillianceMenu(false);
    setShowUserPanel((previous) => !previous);
  };

  const handleUserAuthenticated = async () => {
    setShowUserPanel(false);
  };

  return (
    <>
      <AppTopBar
        pageLabel={pageLabels[currentPage]}
        clockDate={clockDate}
        isOnAuthGate={isOnAuthGate}
        showNavigationMenu={showNavigationMenu}
        showUserPanel={showUserPanel}
        onToggleNavigationMenu={handleNavigationMenuToggle}
        onToggleBrillianceMenu={handleBrillianceToggle}
        onToggleUserPanel={handleUserPanelToggle}
      />

      {showUserPanel && (
        <div ref={userPanelRef}>
          <UserPanel onSignedIn={handleUserAuthenticated} />
        </div>
      )}

      {showNavigationMenu && (
        <NavigationPanel
          currentPage={currentPage}
          onNavigate={handleNavigationItemClick}
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
        className={["main", currentPage === "components" ? "main--no-padding" : ""]
          .filter(Boolean)
          .join(" ")}
      >
        {showBrillianceMenu && (
          <div ref={brillianceRef} className="brilliance">
            <ObcBrillianceMenu onPaletteChanged={handleBrillianceChange} show-auto-brightness />
          </div>
        )}

        <Routes>
          <Route
            path="/datavision"
            element={
              <Datavision
                externalStreamId={externalStreamId}
                onAuthGateVisibleChange={handleAuthGateVisibleChange}
              />
            }
          />
          <Route path="/ais" element={<Ais />} />
          <Route path="/media-library" element={<MediaLibrary />} />
          <Route path="/components" element={<Components />} />
          <Route path="/fusion" element={<Fusion />} />
          <Route path="/control-customization" element={<ControlCustomization />} />
          <Route path="/" element={<Navigate to="/datavision" replace />} />
          <Route path="*" element={<Navigate to="/datavision" replace />} />
        </Routes>
      </main>
    </>
  );
}

export default App;
