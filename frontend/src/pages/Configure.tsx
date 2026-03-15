import { useState } from "react";
import { ObcPivotItemGroup } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/pivot-item-group/pivot-item-group";
import { ObcPivotItem } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/pivot-item/pivot-item";
import MediaLibrary from "./media-library/MediaLibrary";
import ControlCustomization from "./ControlCustomization";
import "./Configure.css";

type ConfigureTab = "media-library" | "toolbar-config";

export default function Configure() {
  const [activeTab, setActiveTab] = useState<ConfigureTab>("media-library");

  const handleTabChange = (event: CustomEvent) => {
    setActiveTab(event.detail.selectedValue as ConfigureTab);
  };

  return (
    <div className="configure-page">
      <div className="configure-page__pivot-row">
        <ObcPivotItemGroup selectedValue={activeTab} onChange={handleTabChange}>
          <ObcPivotItem value="media-library" label="Media library" hasLabel />
          <ObcPivotItem value="toolbar-config" label="Toolbar config." hasLabel />
        </ObcPivotItemGroup>
      </div>

      <div className="configure-page__content">
        {activeTab === "media-library" && (
          <>
            <div className="configure-page__header">
              <h2 className="configure-page__title">Media Library</h2>
              <p className="configure-page__subtitle">
                Manage your live streams and uploaded assets
              </p>
            </div>
            <MediaLibrary embedded />
          </>
        )}
        {activeTab === "toolbar-config" && (
          <>
            <div className="configure-page__header">
              <h2 className="configure-page__title">Toolbar Configuration</h2>
              <p className="configure-page__subtitle">
                Choose which controls are shown in the AR panel
              </p>
            </div>
            <ControlCustomization embedded />
          </>
        )}
      </div>
    </div>
  );
}
