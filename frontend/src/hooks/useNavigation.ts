import { useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export type PageId =
  | "datavision"
  | "ais"
  | "media-library"
  | "components"
  | "fusion"
  | "control-customization";

const PAGE_PATHS: Record<PageId, string> = {
  datavision: "/datavision",
  ais: "/ais",
  "media-library": "/media-library",
  components: "/components",
  fusion: "/fusion",
  "control-customization": "/control-customization",
};

const pageLabels: Record<PageId, string> = {
  datavision: "Datavision",
  ais: "AIS",
  "media-library": "Media Library",
  components: "Components",
  fusion: "Fusion",
  "control-customization": "Control Customization",
};

const PATH_TO_PAGE = new Map(
  (Object.entries(PAGE_PATHS) as [PageId, string][]).map(([id, path]) => [path.slice(1), id])
);

const getPageFromPath = (pathname: string): PageId => {
  const rootSegment = pathname.replace(/^\/+/, "").split("/")[0];
  return PATH_TO_PAGE.get(rootSegment) ?? "datavision";
};

/**
 * @example
 * ```tsx
 * const { currentPage, handleNavigationItemClick } = useNavigation();
 * ```
 */
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
