import { Fragment } from "react";
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
import type {
  ARControlPanelVisibilityKey,
  PoiDropdownValue,
  RangeValue,
} from "./ar-control-context";
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

interface ARControlPanelProps {
  interactive?: boolean;
}

export function ARControlPanel({ interactive = true }: ARControlPanelProps) {
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

  const renderControl = (key: ARControlPanelVisibilityKey) => {
    switch (key) {
      case "rangeVisible":
        return (
          <div className="obc-component-size-regular">
            <ObcDropdownButton
              className="ar-control-bar__range"
              title="Range selection"
              type={DropdownButtonType.labelIcon}
              options={RANGE_OPTIONS}
              value={state.rangeValue}
              onChange={
                interactive ? (event) => setRangeValue(event.detail.value as RangeValue) : undefined
              }
            >
              <ObiRadarRangeProposal slot="icon" />
            </ObcDropdownButton>
          </div>
        );
      case "rulerVisible":
        return (
          <ObcIconButton
            variant={IconButtonVariant.flat}
            activated={state.rulerVisible}
            title="Ruler"
            onClick={interactive ? () => toggle("rulerVisible") : undefined}
          >
            <ObiRadarRangeProposal />
          </ObcIconButton>
        );
      case "buoyLightsVisible":
        return (
          <ObcIconButton
            variant={IconButtonVariant.flat}
            activated={buoyAndLightOn}
            title="Buoy + lighthouse"
            onClick={
              interactive
                ? () => setPair("buoyLayerVisible", "flotsamLayerVisible", !buoyAndLightOn)
                : undefined
            }
          >
            <ObiBuoySparEast />
          </ObcIconButton>
        );
      case "vesselVisible":
        return (
          <ObcIconButton
            variant={IconButtonVariant.flat}
            activated={state.vesselLayerVisible}
            title="Boat"
            onClick={interactive ? () => toggle("vesselLayerVisible") : undefined}
          >
            <ObiVesselTypeGenericOutlined />
          </ObcIconButton>
        );
      case "aisDataVisible":
        return (
          <ObcIconButton
            variant={IconButtonVariant.flat}
            activated={aisDataOn}
            title="AIS Data"
            onClick={
              interactive
                ? () => setPair("aisCardsVisible", "mobLayerVisible", !aisDataOn)
                : undefined
            }
          >
            <ObiAisProposal />
          </ObcIconButton>
        );
      case "imageDataVisible":
        return (
          <ObcIconButton
            variant={IconButtonVariant.flat}
            activated={state.imageDataVisible}
            title="Image Data"
            onClick={interactive ? () => toggle("imageDataVisible") : undefined}
          >
            <ObiCamera />
          </ObcIconButton>
        );
      case "poiSettingsVisible":
        return (
          <div className="obc-component-size-regular">
            <ObcDropdownButton
              className="ar-control-bar__poi-dropdown"
              title="POI settings"
              type={DropdownButtonType.labelIcon}
              options={POI_OPTIONS}
              value={state.poiDropdownValue}
              onChange={
                interactive
                  ? (event) => {
                      const value = event.detail.value as PoiDropdownValue;
                      setPoiDropdownValue(value);
                      if (value === "poi-show" && !state.poiVisible) toggle("poiVisible");
                      if (value === "poi-hide" && state.poiVisible) toggle("poiVisible");
                    }
                  : undefined
              }
            >
              <ObiTargetSettingsProposal slot="icon" />
            </ObcDropdownButton>
          </div>
        );
      case "videoFitVisible":
        return (
          <ObcIconButton
            variant={IconButtonVariant.flat}
            activated={state.videoFitMode === "cover"}
            title={
              state.videoFitMode === "cover" ? "Fill Screen (Crop)" : "Fit to Screen (Letterbox)"
            }
            onClick={
              interactive
                ? () => setVideoFitMode(state.videoFitMode === "cover" ? "contain" : "cover")
                : undefined
            }
          >
            <ObiExpand />
          </ObcIconButton>
        );
    }
  };

  return (
    <div className="ar-control-bar">
      {AR_PANEL_CONTROL_DEFINITIONS.map((control) =>
        panelVisibility[control.key] ? (
          <Fragment key={control.key}>{renderControl(control.key)}</Fragment>
        ) : null
      )}
    </div>
  );
}
