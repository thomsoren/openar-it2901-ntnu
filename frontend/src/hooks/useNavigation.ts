import { useEffect, useState } from "react";

const PAGE_STORAGE_KEY = "openar.currentPage";
const PAGES = ["datavision", "ais", "components", "fusion", "settings"] as const;

export type PageId = (typeof PAGES)[number];

const pageLabels: Record<PageId, string> = {
  datavision: "Datavision",
  ais: "AIS",
  components: "Components",
  fusion: "Fusion",
  settings: "Settings",
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

  useEffect(() => {
    try {
      localStorage.setItem(PAGE_STORAGE_KEY, currentPage);
    } catch {
      // Ignore storage failures.
    }
  }, [currentPage]);

  const handleNavigationItemClick = (page: PageId) => {
    setCurrentPage(page);
    setShowNavigationMenu(false);
    setShowUserPanel(false);
  };

  return {
    showBrillianceMenu,
    showNavigationMenu,
    showUserPanel,
    currentPage,
    pageLabels,
    setShowBrillianceMenu,
    setShowNavigationMenu,
    setShowUserPanel,
    handleNavigationItemClick,
  };
}
