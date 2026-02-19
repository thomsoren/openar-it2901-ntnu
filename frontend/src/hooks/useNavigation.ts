import { useEffect, useState } from "react";

const PAGE_STORAGE_KEY = "openar.currentPage";
const PAGES = ["datavision", "ais", "components", "fusion", "settings", "upload"] as const;

export type PageId = (typeof PAGES)[number];
export type AuthGateMode = "login" | "signup";

const pageLabels: Record<PageId, string> = {
  datavision: "Datavision",
  ais: "AIS",
  components: "Components",
  fusion: "Fusion",
  settings: "Settings",
  upload: "Upload",
};

const getStoredPage = (): PageId => {
  try {
    const stored = localStorage.getItem(PAGE_STORAGE_KEY) as PageId | null;
    if (stored && PAGES.includes(stored)) {
      return stored;
    }
  } catch {
    // Ignore storage failures.
  }
  return "datavision";
};

export function useNavigation() {
  const [showBrillianceMenu, setShowBrillianceMenu] = useState(false);
  const [showNavigationMenu, setShowNavigationMenu] = useState(false);
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [currentPage, setCurrentPage] = useState<PageId>(() => getStoredPage());
  const [authGateMode, setAuthGateMode] = useState<AuthGateMode>("login");

  useEffect(() => {
    try {
      localStorage.setItem(PAGE_STORAGE_KEY, currentPage);
    } catch {
      // Ignore storage failures.
    }
  }, [currentPage]);

  const handleNavigationItemClick = (page: PageId) => {
    setCurrentPage(page);
    if (page === "upload") {
      setAuthGateMode("login");
    }
    setShowNavigationMenu(false);
    setShowUserPanel(false);
  };

  return {
    showBrillianceMenu,
    showNavigationMenu,
    showUserPanel,
    currentPage,
    authGateMode,
    pageLabels,
    setShowBrillianceMenu,
    setShowNavigationMenu,
    setShowUserPanel,
    handleNavigationItemClick,
  };
}
