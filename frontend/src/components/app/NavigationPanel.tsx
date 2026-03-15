import { ObcNavigationMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-menu/navigation-menu";
import { ObcNavigationItem } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-item/navigation-item";
import { ObiCamera } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-camera";
import { ObiEcdisProposal } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ecdis-proposal";
import { ObiConfigure } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-configure";
import { ObiPlaceholder } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-placeholder";
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
          label="Live stream"
          checked={currentPage === "ar"}
          hasIcon
          onClick={() => onNavigate("ar")}
        >
          <ObiCamera slot="icon" />
        </ObcNavigationItem>
        <ObcNavigationItem
          label="Map"
          checked={currentPage === "ais"}
          hasIcon
          onClick={() => onNavigate("ais")}
        >
          <ObiEcdisProposal slot="icon" />
        </ObcNavigationItem>
        <ObcNavigationItem
          label="Configure"
          checked={currentPage === "control-customization"}
          hasIcon
          onClick={() => onNavigate("control-customization")}
        >
          <ObiConfigure slot="icon" />
        </ObcNavigationItem>
        <ObcNavigationItem
          label="Components"
          checked={currentPage === "components"}
          hasIcon
          onClick={() => onNavigate("components")}
        >
          <ObiPlaceholder slot="icon" />
        </ObcNavigationItem>
      </div>
    </ObcNavigationMenu>
  );
}
