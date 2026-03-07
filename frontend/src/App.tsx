import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/openbridge.css";
import { ObcBrillianceMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/brilliance-menu/brilliance-menu";
import "./App.css";
import MediaLibrary from "./pages/media-library/MediaLibrary";
import Ais from "./pages/Ais";
import Components from "./pages/Components";
import AROverlay from "./pages/AROverlay";
import ControlCustomization from "./pages/ControlCustomization";
import { useClock } from "./hooks/useClock";
import { useNavigation } from "./hooks/useNavigation";
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

  const handleAuthGateVisibleChange = (visible: boolean) => {
    setIsOnAuthGate(visible);
    if (visible) {
      setShowUserPanel(false);
    }
  };

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
        <NavigationPanel currentPage={currentPage} onNavigate={handleNavigationItemClick} />
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
            path="/ar"
            element={<AROverlay onAuthGateVisibleChange={handleAuthGateVisibleChange} />}
          />
          <Route path="/ais" element={<Ais />} />
          <Route path="/media-library" element={<MediaLibrary />} />
          <Route path="/components" element={<Components />} />
          <Route path="/control-customization" element={<ControlCustomization />} />
          <Route path="/" element={<Navigate to="/ar" replace />} />
          <Route path="*" element={<Navigate to="/ar" replace />} />
        </Routes>
      </main>
    </>
  );
}

export default App;
