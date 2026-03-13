import React from "react";
import { ObcInput } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/input/input";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcStatusIndicator } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/status-indicator/status-indicator";
import { ObcTag } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tag/tag";
import { ObcToggleButtonGroup } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/toggle-button-group/toggle-button-group";
import { ObcToggleButtonOption } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/toggle-button-option/toggle-button-option";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { HTMLInputTypeAttribute } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/input/input";
import { StatusIndicatorStatus } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/status-indicator/status-indicator";
import { TagColor } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/tag/tag";
import { ObcToggleButtonOptionType } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/toggle-button-option/toggle-button-option";
import { ObiAisTargetSleepingIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-ais-target-sleeping-iec";
import { ObiVesselTypeGenericFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-type-generic-filled";
import { ObiVesselGenericDefaultFilled } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-vessel-generic-default-filled";
import { type VesselIconSet } from "../../utils/vesselIconMapper";
import "./AISMapParameterPanel.css";

const VESSEL_ICON_SET_OPTIONS: Array<{
  value: VesselIconSet;
  label: string;
  Icon: React.ComponentType<{ slot?: string }>;
}> = [
  { value: "generic", label: "AIS", Icon: ObiAisTargetSleepingIec },
  { value: "detailed", label: "Vessel type", Icon: ObiVesselTypeGenericFilled },
  { value: "directional", label: "Speed", Icon: ObiVesselGenericDefaultFilled },
];

interface AISMapParameterPanelProps {
  streamState: {
    isStreaming: boolean;
    isLoadingGPS: boolean;
    error?: string;
    vesselCount: number;
  };
  settings: AISMapParameterSettings;
  onSetShouldStream: (stream: boolean) => void;
  onUseGPSLocation: () => void;
  onSettingsChange: (updates: Partial<AISMapParameterSettings>) => void;
}

export interface AISMapParameterSettings {
  shipLat: number;
  shipLon: number;
  heading: number;
  offsetMeters: number;
  fovDegrees: number;
  shapeMode: "wedge" | "rect";
  rectLength: number;
  rectWidth: number;
  editMode: boolean;
  iconSet: VesselIconSet;
}

const isVesselIconSet = (value: string): value is VesselIconSet =>
  value === "generic" || value === "detailed" || value === "directional";

const isShapeMode = (value: string): value is "wedge" | "rect" =>
  value === "wedge" || value === "rect";

export const AISMapParameterPanel: React.FC<AISMapParameterPanelProps> = ({
  streamState,
  settings,
  onSetShouldStream,
  onUseGPSLocation,
  onSettingsChange,
}) => {
  const { isStreaming, isLoadingGPS, error, vesselCount } = streamState;
  const {
    shipLat,
    shipLon,
    heading,
    offsetMeters,
    fovDegrees,
    shapeMode,
    rectLength,
    rectWidth,
    editMode,
    iconSet,
  } = settings;

  const parseNumberInput = (event: Event, fallback: number): number => {
    const rawValue = (event.target as { value?: string }).value ?? "";
    const parsedValue = Number.parseFloat(rawValue);
    return Number.isNaN(parsedValue) ? fallback : parsedValue;
  };

  return (
    <aside className="ais-map-panel" aria-label="AIS controls">
      <div className="ais-map-panel__section ais-map-panel__section--stream">
        <div className="ais-map-panel__meta">
          <ObcStatusIndicator
            status={isStreaming ? StatusIndicatorStatus.running : StatusIndicatorStatus.inactive}
          >
            {isStreaming ? "Streaming" : "Idle"}
          </ObcStatusIndicator>
          <ObcTag label={`${vesselCount} vessels`} color={TagColor.blue} />
        </div>

        <div className="ais-map-panel__button-row">
          <ObcButton
            variant={ButtonVariant.raised}
            onClick={() => onSetShouldStream(true)}
            disabled={isStreaming}
          >
            Start
          </ObcButton>
          <ObcButton
            variant={ButtonVariant.raised}
            onClick={() => onSetShouldStream(false)}
            disabled={!isStreaming}
          >
            Stop
          </ObcButton>
        </div>

        {error && (
          <ObcStatusIndicator status={StatusIndicatorStatus.alarm}>
            Error: {error}
          </ObcStatusIndicator>
        )}
      </div>

      <div className="ais-map-panel__section">
        <h3>Position</h3>
        <div className="ais-map-panel__grid">
          <label className="ais-map-panel__field">
            <span>Longitude</span>
            <ObcInput
              type={HTMLInputTypeAttribute.Number}
              value={String(shipLon)}
              disabled={isStreaming}
              onInput={(event) => onSettingsChange({ shipLon: parseNumberInput(event, shipLon) })}
            />
          </label>
          <label className="ais-map-panel__field">
            <span>Latitude</span>
            <ObcInput
              type={HTMLInputTypeAttribute.Number}
              value={String(shipLat)}
              disabled={isStreaming}
              onInput={(event) => onSettingsChange({ shipLat: parseNumberInput(event, shipLat) })}
            />
          </label>
        </div>

        <ObcButton
          variant={ButtonVariant.normal}
          onClick={onUseGPSLocation}
          disabled={isStreaming || isLoadingGPS}
        >
          {isLoadingGPS ? "Fetching..." : "Use current position"}
        </ObcButton>
        <p className="ais-map-panel__hint">Autofill GPS coordinates</p>
      </div>

      <div className="ais-map-panel__section">
        <h3>Camera adjustments</h3>
        <div className="ais-map-panel__grid ais-map-panel__grid--three">
          <label className="ais-map-panel__field">
            <span>Heading</span>
            <ObcInput
              type={HTMLInputTypeAttribute.Number}
              value={String(heading)}
              disabled={isStreaming}
              onInput={(event) => onSettingsChange({ heading: parseNumberInput(event, heading) })}
            />
          </label>

          {shapeMode === "wedge" ? (
            <>
              <label className="ais-map-panel__field">
                <span>Range</span>
                <ObcInput
                  type={HTMLInputTypeAttribute.Number}
                  value={String(offsetMeters)}
                  disabled={isStreaming}
                  onInput={(event) =>
                    onSettingsChange({
                      offsetMeters: parseNumberInput(event, offsetMeters),
                    })
                  }
                />
              </label>
              <label className="ais-map-panel__field">
                <span>FOV</span>
                <ObcInput
                  type={HTMLInputTypeAttribute.Number}
                  value={String(fovDegrees)}
                  disabled={isStreaming}
                  onInput={(event) =>
                    onSettingsChange({
                      fovDegrees: parseNumberInput(event, fovDegrees),
                    })
                  }
                />
              </label>
            </>
          ) : (
            <>
              <label className="ais-map-panel__field">
                <span>Length</span>
                <ObcInput
                  type={HTMLInputTypeAttribute.Number}
                  value={String(rectLength)}
                  disabled={isStreaming}
                  onInput={(event) =>
                    onSettingsChange({
                      rectLength: parseNumberInput(event, rectLength),
                    })
                  }
                />
              </label>
              <label className="ais-map-panel__field">
                <span>Width</span>
                <ObcInput
                  type={HTMLInputTypeAttribute.Number}
                  value={String(rectWidth)}
                  disabled={isStreaming}
                  onInput={(event) =>
                    onSettingsChange({
                      rectWidth: parseNumberInput(event, rectWidth),
                    })
                  }
                />
              </label>
            </>
          )}
        </div>
      </div>

      <div className="ais-map-panel__section">
        <h3>Display preferences</h3>
        <span className="ais-map-panel__inline-label">Icon type</span>
        <div>
          <ObcToggleButtonGroup
            value={iconSet}
            type={ObcToggleButtonOptionType.iconText}
            onValue={(event) => {
              const value = event.detail.value;
              if (isVesselIconSet(value)) {
                onSettingsChange({ iconSet: value });
              }
            }}
          >
            {VESSEL_ICON_SET_OPTIONS.map(({ value, label, Icon }) => (
              <ObcToggleButtonOption key={value} value={value}>
                <Icon slot="icon" />
                {label}
              </ObcToggleButtonOption>
            ))}
          </ObcToggleButtonGroup>
        </div>

        <span className="ais-map-panel__inline-label">Editing</span>
        <div>
          <ObcToggleButtonGroup
            value={editMode ? "enabled" : "locked"}
            type={ObcToggleButtonOptionType.text}
            onValue={(event) => {
              const value = event.detail.value;
              onSettingsChange({ editMode: value === "enabled" });
            }}
          >
            <ObcToggleButtonOption value="enabled">Enabled</ObcToggleButtonOption>
            <ObcToggleButtonOption value="locked">Locked</ObcToggleButtonOption>
          </ObcToggleButtonGroup>
        </div>
      </div>

      <div className="ais-map-panel__section">
        <span className="ais-map-panel__inline-label">Area shape</span>
        <div>
          <ObcToggleButtonGroup
            value={shapeMode}
            type={ObcToggleButtonOptionType.text}
            onValue={(event) => {
              const value = event.detail.value;
              if (isShapeMode(value)) {
                onSettingsChange({ shapeMode: value });
              }
            }}
          >
            <ObcToggleButtonOption value="wedge">Sector</ObcToggleButtonOption>
            <ObcToggleButtonOption value="rect">Rectangle</ObcToggleButtonOption>
          </ObcToggleButtonGroup>
        </div>
      </div>
    </aside>
  );
};
