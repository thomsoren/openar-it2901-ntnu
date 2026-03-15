import { useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export type PageId = "ar" | "ais" | "components" | "control-customization";

const PAGE_PATHS: Record<PageId, string> = {
  ar: "/ar",
  ais: "/ais",
  components: "/components",
  "control-customization": "/control-customization",
};

const pageLabels: Record<PageId, string> = {
  ar: "Live stream",
  ais: "Map",
  components: "Components",
  "control-customization": "Configure",
};

const getPageFromPath = (pathname: string): PageId => {
  const rootSegment = pathname.replace(/^\/+/, "").split("/")[0];
  switch (rootSegment) {
    case "ais":
      return "ais";
    case "components":
      return "components";
    case "control-customization":
      return "control-customization";
    case "ar":
    default:
      return "ar";
  }
};

export function useNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const [showBrillianceMenu, setShowBrillianceMenu] = useState(false);
  const [showNavigationMenu, setShowNavigationMenu] = useState(false);
  const [showUserPanel, setShowUserPanel] = useState(false);
  const currentPage = useMemo(() => getPageFromPath(location.pathname), [location.pathname]);

  const handleNavigationItemClick = useCallback(
    (page: PageId) => {
      navigate(PAGE_PATHS[page]);
      setShowNavigationMenu(false);
      setShowUserPanel(false);
    },
    [navigate]
  );

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
