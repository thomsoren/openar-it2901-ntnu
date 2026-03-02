import { ObcIconButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/icon-button/icon-button";
import { ObcDropdownButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/dropdown-button/dropdown-button";
import { IconButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/icon-button/icon-button";
import { DropdownButtonType } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/dropdown-button/dropdown-button";
import { ObiBuoySparEast } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-buoy-spar-east";
import { ObiRadarRangeProposal } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-radar-range-proposal";
import { ObiVesselTypeGenericOutlined } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-generic-outlined";
import { ObiAisProposal } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-proposal";
import { ObiCamera } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-camera";
import { ObiTargetSettingsProposal } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-target-settings-proposal";
import { ObiExpand } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-expand";
import { useARControls } from "./useARControls";
import type { PoiDropdownValue, RangeValue } from "./ar-control-context";
import { AR_PANEL_CONTROL_DEFINITIONS } from "./panel-controls";
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
  const { state, panelVisibility, toggle, setRangeValue, setPoiDropdownValue, setVideoFitMode } =
    useARControls();

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

  const controls = {
    rangeVisible: (
      <div key="rangeVisible" className="obc-component-size-regular">
        <ObcDropdownButton
          className="ar-control-bar__range"
          title="Range selection"
          type={DropdownButtonType.labelIcon}
          options={RANGE_OPTIONS}
          value={state.rangeValue}
          onChange={(event) => setRangeValue(event.detail.value as RangeValue)}
        >
          <ObiRadarRangeProposal slot="icon" />
        </ObcDropdownButton>
      </div>
    ),
    rulerVisible: (
      <ObcIconButton
        key="rulerVisible"
        variant={IconButtonVariant.flat}
        activated={state.rulerVisible}
        title="Ruler"
        onClick={() => toggle("rulerVisible")}
      >
        <ObiRadarRangeProposal />
      </ObcIconButton>
    ),
    buoyLightsVisible: (
      <ObcIconButton
        key="buoyLightsVisible"
        variant={IconButtonVariant.flat}
        activated={buoyAndLightOn}
        title="Buoy + lighthouse"
        onClick={() => setPair("buoyLayerVisible", "flotsamLayerVisible", !buoyAndLightOn)}
      >
        <ObiBuoySparEast />
      </ObcIconButton>
    ),
    vesselVisible: (
      <ObcIconButton
        key="vesselVisible"
        variant={IconButtonVariant.flat}
        activated={state.vesselLayerVisible}
        title="Boat"
        onClick={() => toggle("vesselLayerVisible")}
      >
        <ObiVesselTypeGenericOutlined />
      </ObcIconButton>
    ),
    aisDataVisible: (
      <ObcIconButton
        key="aisDataVisible"
        variant={IconButtonVariant.flat}
        activated={aisDataOn}
        title="AIS Data"
        onClick={() => setPair("aisCardsVisible", "mobLayerVisible", !aisDataOn)}
      >
        <ObiAisProposal />
      </ObcIconButton>
    ),
    imageDataVisible: (
      <ObcIconButton
        key="imageDataVisible"
        variant={IconButtonVariant.flat}
        activated={state.imageDataVisible}
        title="Image Data"
        onClick={() => toggle("imageDataVisible")}
      >
        <ObiCamera />
      </ObcIconButton>
    ),
    poiSettingsVisible: (
      <div key="poiSettingsVisible" className="obc-component-size-regular">
        <ObcDropdownButton
          className="ar-control-bar__poi-dropdown"
          title="POI settings"
          type={DropdownButtonType.labelIcon}
          options={POI_OPTIONS}
          value={state.poiDropdownValue}
          onChange={(event) => {
            const value = event.detail.value as PoiDropdownValue;
            setPoiDropdownValue(value);
            if (value === "poi-show" && !state.poiVisible) toggle("poiVisible");
            if (value === "poi-hide" && state.poiVisible) toggle("poiVisible");
          }}
        >
          <ObiTargetSettingsProposal slot="icon" />
        </ObcDropdownButton>
      </div>
    ),
    videoFitVisible: (
      <ObcIconButton
        key="videoFitVisible"
        variant={IconButtonVariant.flat}
        activated={state.videoFitMode === "cover"}
        title={state.videoFitMode === "cover" ? "Fill Screen (Crop)" : "Fit to Screen (Letterbox)"}
        onClick={() => setVideoFitMode(state.videoFitMode === "cover" ? "contain" : "cover")}
      >
        <ObiExpand />
      </ObcIconButton>
    ),
  } as const;

  return (
    <div className="ar-control-bar">
      {AR_PANEL_CONTROL_DEFINITIONS.map(
        (control) => panelVisibility[control.key] && controls[control.key]
      )}
    </div>
  );
}
