import { useEffect, useState } from "react";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/openbridge.css";
import { ObcTopBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/top-bar/top-bar";
import { ObcBrillianceMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/brilliance-menu/brilliance-menu";
import { ObcClock } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/clock/clock";
import { ObcNavigationMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-menu/navigation-menu";
import { ObcNavigationItem } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-item/navigation-item";
import "./App.css";
import Ais from "./pages/Ais";
import Fusion from "./pages/Fusion";
import Components from "./pages/Components";
import Datavision from "./pages/Datavision";
import Settings from "./pages/Settings";

const PAGE_STORAGE_KEY = "openar.currentPage";
const PAGES = ["datavision", "ais", "components", "fusion", "settings"] as const;
type PageId = (typeof PAGES)[number];

const getStoredPage = (): PageId => {
  try {
    const stored = localStorage.getItem(PAGE_STORAGE_KEY) as PageId | null;
    if (stored && PAGES.includes(stored)) {
      return stored;
    }
  } catch {
    // Ignore storage failures (private mode, blocked storage, etc.).
  }
  return "datavision";
};

const handleBrillianceChange = (e: CustomEvent) => {
  document.documentElement.setAttribute("data-obc-theme", e.detail.value);
};

function App() {
  const [showBrillianceMenu, setShowBrillianceMenu] = useState(false);
  const [showNavigationMenu, setShowNavigationMenu] = useState(false);
  const [currentPage, setCurrentPage] = useState<PageId>(() => getStoredPage());

  const pageLabels = {
    datavision: "Datavision",
    ais: "AIS",
    components: "Components",
    fusion: "Fusion",
    settings: "Settings",
  } as const;

  const handleDimmingButtonClicked = () => {
    setShowBrillianceMenu((prev) => !prev);
  };

  const handleMenuButtonClicked = () => {
    setShowNavigationMenu((prev) => !prev);
  };

  const handleNavigationItemClick = (page: PageId) => {
    setCurrentPage(page);
    setShowNavigationMenu(false);
  };

  useEffect(() => {
    try {
      localStorage.setItem(PAGE_STORAGE_KEY, currentPage);
    } catch {
      // Ignore storage failures (private mode, blocked storage, etc.).
    }
  }, [currentPage]);

  return (
    <>
      <header>
        <ObcTopBar
          appTitle="OpenAR"
          pageName={pageLabels[currentPage]}
          showDimmingButton
          showAppsButton
          menuButtonActivated={showNavigationMenu}
          onMenuButtonClicked={handleMenuButtonClicked}
          onDimmingButtonClicked={handleDimmingButtonClicked}
        >
          <ObcClock
            date={new Date().toISOString()}
            timeZoneOffsetHours={new Date().getTimezoneOffset() / -60}
            showTimezone
            blinkOnlyBreakpointPx={600}
          />
        </ObcTopBar>
      </header>

      {showNavigationMenu && (
        <ObcNavigationMenu className="navigation-menu">
          <div slot="main">
            <ObcNavigationItem
              label="Fusion"
              checked={currentPage === "fusion"}
              onClick={() => handleNavigationItemClick("fusion")}
            />
            <ObcNavigationItem
              label="Datavision"
              checked={currentPage === "datavision"}
              onClick={() => handleNavigationItemClick("datavision")}
            />
            <ObcNavigationItem
              label="AIS"
              checked={currentPage === "ais"}
              onClick={() => handleNavigationItemClick("ais")}
            />
            <ObcNavigationItem
              label="Components"
              checked={currentPage === "components"}
              onClick={() => handleNavigationItemClick("components")}
            />
            <ObcNavigationItem
              label="Settings"
              checked={currentPage === "settings"}
              onClick={() => handleNavigationItemClick("settings")}
            />
          </div>
        </ObcNavigationMenu>
      )}

      <main
        className={[
          "main",
          showNavigationMenu ? "main--with-sidebar" : "",
          currentPage === "components" ? "main--no-padding" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {showBrillianceMenu && (
          <ObcBrillianceMenu
            onPaletteChanged={handleBrillianceChange}
            show-auto-brightness
            className="brilliance"
          />
        )}

        {currentPage === "datavision" && <Datavision />}
        {currentPage === "ais" && <Ais />}
        {currentPage === "components" && <Components />}
        {currentPage === "fusion" && <Fusion />}
        {currentPage === "settings" && <Settings />}
      </main>
    </>
  );
}

export default App;
