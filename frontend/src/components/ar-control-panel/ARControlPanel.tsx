import { useState } from "react";
import { ObcIconButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/icon-button/icon-button";
import { ObcDropdownButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/dropdown-button/dropdown-button";
import { IconButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/icon-button/icon-button";
import { ObiRadarRangeProposal } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-radar-range-proposal";
import { ObiRangeRingsIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-range-rings-iec";
import { ObiBuoySparEast } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-buoy-spar-east";
import { ObiVesselTypeGenericOutlined } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-generic-outlined";
import { ObiAisProposal } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-proposal";
import { ObiCamera } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-camera";
import { ObiTargetSettingsProposal } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-target-settings-proposal";
import { useARControls } from "./useARControls";
import "./ARControlPanel.css";

const RANGE_OPTIONS = [
  { value: "off", label: "OFF" },
  { value: "3", label: "3 NM" },
  { value: "5", label: "5 NM" },
  { value: "10.5", label: "10,5 NM" },
  { value: "24", label: "24 NM" },
];
const POI_OPTIONS = [
  { value: "poi-visible", label: "Toggle POI data" },
  { value: "poi-display", label: "Data display" },
  { value: "poi-icon", label: "Icon type" },
];

export function ARControlPanel() {
  const { state, toggle } = useARControls();
  const [rangeValue, setRangeValue] = useState(state.rangeVisible ? "10.5" : "off");

  const buoyAndLightOn = state.buoyLayerVisible && state.flotsamLayerVisible;
  const aisDataOn = state.aisCardsVisible && state.mobLayerVisible;
  const setRange = (value: string) => {
    setRangeValue(value);
    const enabled = value !== "off";
    if (state.rangeVisible !== enabled) toggle("rangeVisible");
  };
  const setPair = (
    first: "buoyLayerVisible" | "aisCardsVisible",
    second: "flotsamLayerVisible" | "mobLayerVisible",
    next: boolean
  ) => {
    if (state[first] !== next) toggle(first);
    if (state[second] !== next) toggle(second);
  };

  return (
    <div className="ar-control-bar">
      <div className="ar-control-bar__range-group">
        <ObcIconButton
          variant={IconButtonVariant.flat}
          activated={state.rangeVisible}
          title="Range"
          onClick={() => setRange(state.rangeVisible ? "off" : "10.5")}
        >
          <ObiRadarRangeProposal />
        </ObcIconButton>
        <ObcDropdownButton
          className="ar-control-bar__range"
          options={RANGE_OPTIONS}
          value={rangeValue}
          onChange={(event) => setRange(event.detail.value)}
        />
      </div>

      <ObcIconButton
        variant={IconButtonVariant.flat}
        activated={state.rulerVisible}
        title="Ruler"
        onClick={() => toggle("rulerVisible")}
      >
        <ObiRangeRingsIec />
      </ObcIconButton>
      <ObcIconButton
        variant={IconButtonVariant.flat}
        activated={buoyAndLightOn}
        title="Buoy + lighthouse"
        onClick={() => setPair("buoyLayerVisible", "flotsamLayerVisible", !buoyAndLightOn)}
      >
        <ObiBuoySparEast />
      </ObcIconButton>
      <ObcIconButton
        variant={IconButtonVariant.flat}
        activated={state.vesselLayerVisible}
        title="Boat"
        onClick={() => toggle("vesselLayerVisible")}
      >
        <ObiVesselTypeGenericOutlined />
      </ObcIconButton>

      <ObcIconButton
        variant={IconButtonVariant.flat}
        activated={aisDataOn}
        title="AIS Data"
        onClick={() => setPair("aisCardsVisible", "mobLayerVisible", !aisDataOn)}
      >
        <ObiAisProposal />
      </ObcIconButton>
      <ObcIconButton
        variant={IconButtonVariant.flat}
        activated={state.imageDataVisible}
        title="Image Data"
        onClick={() => toggle("imageDataVisible")}
      >
        <ObiCamera />
      </ObcIconButton>

      <div className="ar-control-bar__poi-group">
        <ObcIconButton
          variant={IconButtonVariant.flat}
          activated={state.poiVisible}
          title="POI"
          onClick={() => toggle("poiVisible")}
        >
          <ObiTargetSettingsProposal />
        </ObcIconButton>
        <ObcDropdownButton
          className="ar-control-bar__poi-dropdown"
          options={POI_OPTIONS}
          onChange={(event) => {
            if (event.detail.value === "poi-visible") {
              toggle("poiVisible");
            }
          }}
        />
      </div>
    </div>
  );
}
