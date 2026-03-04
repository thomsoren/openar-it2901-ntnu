import { useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export type PageId = "ar" | "ais" | "components" | "media-library";

const PAGE_PATHS: Record<PageId, string> = {
  ar: "/ar",
  ais: "/ais",
  components: "/components",
  "media-library": "/media-library",
};

const pageLabels: Record<PageId, string> = {
  ar: "AR",
  ais: "AIS",
  components: "Components",
  "media-library": "Media Library",
};

const getPageFromPath = (pathname: string): PageId => {
  const rootSegment = pathname.replace(/^\/+/, "").split("/")[0];
  switch (rootSegment) {
    case "ais":
      return "ais";
    case "components":
      return "components";
    case "media-library":
      return "media-library";
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
