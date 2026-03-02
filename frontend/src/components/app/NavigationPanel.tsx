import { ObcNavigationMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-menu/navigation-menu";
import { ObcNavigationItem } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-item/navigation-item";
import type { PageId } from "../../hooks/useNavigation";

interface NavigationPanelProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  isAdmin: boolean;
}

export function NavigationPanel({ currentPage, onNavigate, isAdmin }: NavigationPanelProps) {
  return (
    <ObcNavigationMenu className="navigation-menu">
      <div slot="main">
        <ObcNavigationItem
          label="Fusion"
          checked={currentPage === "fusion"}
          onClick={() => onNavigate("fusion")}
        />
        <ObcNavigationItem
          label="Datavision"
          checked={currentPage === "datavision"}
          onClick={() => onNavigate("datavision")}
        />
        <ObcNavigationItem
          label="AIS"
          checked={currentPage === "ais"}
          onClick={() => onNavigate("ais")}
        />
        <ObcNavigationItem
          label="Components"
          checked={currentPage === "components"}
          onClick={() => onNavigate("components")}
        />
        {isAdmin && (
          <ObcNavigationItem
            label="Admin"
            checked={currentPage === "admin"}
            onClick={() => onNavigate("admin")}
          />
        )}
      </div>
    </ObcNavigationMenu>
  );
}
