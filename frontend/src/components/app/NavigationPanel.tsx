import { ObcNavigationMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-menu/navigation-menu";
import { ObcNavigationItem } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-item/navigation-item";
import type { PageId } from "../../hooks/useNavigation";

interface NavigationPanelProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
}

export function NavigationPanel({ currentPage, onNavigate }: NavigationPanelProps) {
  return (
    <ObcNavigationMenu className="navigation-menu">
      <div slot="main">
        <ObcNavigationItem
          label="AR"
          checked={currentPage === "ar"}
          onClick={() => onNavigate("ar")}
        />
        <ObcNavigationItem
          label="AIS"
          checked={currentPage === "ais"}
          onClick={() => onNavigate("ais")}
        />
        <ObcNavigationItem
          label="Media Library"
          checked={currentPage === "media-library"}
          onClick={() => onNavigate("media-library")}
        />
        <ObcNavigationItem
          label="Components"
          checked={currentPage === "components"}
          onClick={() => onNavigate("components")}
        />
      </div>
    </ObcNavigationMenu>
  );
}
