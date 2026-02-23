import { ObcIconButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/icon-button/icon-button";
import { ObcDropdownButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/dropdown-button/dropdown-button";
import { IconButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/icon-button/icon-button";
import { ObiRangeRingsIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-range-rings-iec";
import { ObiBuoySparEast } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-buoy-spar-east";
import { ObiVesselTypeGenericOutlined } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-generic-outlined";
import { ObiAisProposal } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-proposal";
import { ObiCamera } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-camera";
import { useARControls } from "./useARControls";
import type { PoiDropdownValue, RangeValue } from "./ar-control-context";
import "./ARControlPanel.css";

const RANGE_OPTIONS: { value: RangeValue; label: string }[] = [
  { value: "off", label: "Range: OFF" },
  { value: "3", label: "3 NM" },
  { value: "5", label: "5 NM" },
  { value: "10.5", label: "10,5 NM" },
  { value: "24", label: "24 NM" },
];
const POI_OPTIONS: { value: PoiDropdownValue; label: string }[] = [
  { value: "poi-show", label: "Show POI data" },
  { value: "poi-hide", label: "Hide POI data" },
  { value: "poi-display", label: "POI data display" },
  { value: "poi-icon", label: "POI icon type" },
];

export function ARControlPanel() {
  const { state, toggle, setRangeValue, setPoiDropdownValue } = useARControls();

  const buoyAndLightOn = state.buoyLayerVisible && state.flotsamLayerVisible;
  const aisDataOn = state.aisCardsVisible && state.mobLayerVisible;
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
      <ObcDropdownButton
        className="ar-control-bar__range"
        title="Range selection"
        options={RANGE_OPTIONS}
        value={state.rangeValue}
        onChange={(event) => setRangeValue(event.detail.value as RangeValue)}
      />

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

      <ObcDropdownButton
        className="ar-control-bar__poi-dropdown"
        title="POI settings"
        options={POI_OPTIONS}
        value={state.poiDropdownValue}
        onChange={(event) => {
          const value = event.detail.value as PoiDropdownValue;
          setPoiDropdownValue(value);
          if (value === "poi-show" && !state.poiVisible) toggle("poiVisible");
          if (value === "poi-hide" && state.poiVisible) toggle("poiVisible");
        }}
      />
    </div>
  );
}
