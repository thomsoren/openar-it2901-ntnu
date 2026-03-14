import React from "react";
import { ObcInput } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/input/input";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcToggleButtonGroup } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/toggle-button-group/toggle-button-group";
import { ObcToggleButtonOption } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/toggle-button-option/toggle-button-option";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import {
  HTMLInputTypeAttribute,
  ObcInputTextAlign,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/input/input";
import { ObcToggleButtonOptionType } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/toggle-button-option/toggle-button-option";
import { ObiContentCollapseGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-content-collapse-google";
import { ObiContentExpandGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-content-expand-google";
import { type VesselIconSet } from "../../utils/vesselIconMapper";
import { VesselIconSetSelector } from "../VesselIconSetSelector/VesselIconSetSelector";
import "./AISMapParameterPanel.css";

type AreaSettingsSnapshot = Pick<
  AISMapParameterSettings,
  | "shipLat"
  | "shipLon"
  | "heading"
  | "offsetMeters"
  | "fovDegrees"
  | "shapeMode"
  | "rectLength"
  | "rectWidth"
>;

// Utility to create a snapshot of the area settings for edit sessions, allowing cancellation of changes
const toAreaSettingsSnapshot = (settings: AISMapParameterSettings): AreaSettingsSnapshot => ({
  shipLat: settings.shipLat,
  shipLon: settings.shipLon,
  heading: settings.heading,
  offsetMeters: settings.offsetMeters,
  fovDegrees: settings.fovDegrees,
  shapeMode: settings.shapeMode,
  rectLength: settings.rectLength,
  rectWidth: settings.rectWidth,
});

interface AISMapParameterPanelProps {
  isLoadingGPS: boolean;
  settings: AISMapParameterSettings;
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

const isShapeMode = (value: string): value is "wedge" | "rect" =>
  value === "wedge" || value === "rect";

export const AISMapParameterPanel: React.FC<AISMapParameterPanelProps> = ({
  isLoadingGPS,
  settings,
  onUseGPSLocation,
  onSettingsChange,
}) => {
  const editSessionStartRef = React.useRef<AreaSettingsSnapshot | null>(null);
  const [isExpanded, setIsExpanded] = React.useState(true);

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

  const handleStartEditing = () => {
    editSessionStartRef.current = toAreaSettingsSnapshot(settings);
    onSettingsChange({ editMode: true });
  };

  const handleSaveEditing = () => {
    editSessionStartRef.current = null;
    onSettingsChange({ editMode: false });
  };

  const handleCancelEditing = () => {
    const sessionStart = editSessionStartRef.current ?? toAreaSettingsSnapshot(settings);
    editSessionStartRef.current = null;
    onSettingsChange({ ...sessionStart, editMode: false });
  };

  const handleToggleExpanded = () => {
    setIsExpanded((current) => !current);
  };

  return (
    <aside
      className={`ais-map-panel ${isExpanded ? "ais-map-panel--expanded" : "ais-map-panel--collapsed"}`}
      aria-label="AIS controls"
    >
      {isExpanded && (
        <>
          <div className="ais-map-panel__section">
            <h3 className="ais-map-panel__section-header">Icon Type</h3>
            <div className="ais-map-panel__icon-type-group">
              <VesselIconSetSelector
                value={iconSet}
                onChange={(value) => onSettingsChange({ iconSet: value })}
              />
            </div>
          </div>

          <div className="ais-map-panel__section">
            <h3 className="ais-map-panel__section-header">Position</h3>
            <div className="ais-map-panel__grid">
              <label className="ais-map-panel__field">
                <span>Longitude</span>
                <ObcInput
                  type={HTMLInputTypeAttribute.Number}
                  textAlign={ObcInputTextAlign.Left}
                  noHorisontalPadding
                  value={String(shipLon)}
                  disabled={!editMode}
                  onInput={(event) =>
                    onSettingsChange({ shipLon: parseNumberInput(event, shipLon) })
                  }
                />
              </label>
              <label className="ais-map-panel__field">
                <span>Latitude</span>
                <ObcInput
                  type={HTMLInputTypeAttribute.Number}
                  textAlign={ObcInputTextAlign.Left}
                  noHorisontalPadding
                  value={String(shipLat)}
                  disabled={!editMode}
                  onInput={(event) =>
                    onSettingsChange({ shipLat: parseNumberInput(event, shipLat) })
                  }
                />
              </label>
            </div>

            <ObcButton
              variant={ButtonVariant.normal}
              onClick={onUseGPSLocation}
              disabled={!editMode || isLoadingGPS}
              fullWidth
            >
              {isLoadingGPS ? "Fetching..." : "Use current position"}
            </ObcButton>
          </div>

          <div className="ais-map-panel__section ais-map-panel__section--area-config">
            <h3 className="ais-map-panel__section-header">Area configuration</h3>
            <div className="ais-map-panel__grid ais-map-panel__grid--three">
              <label className="ais-map-panel__field">
                <span>Heading</span>
                <ObcInput
                  type={HTMLInputTypeAttribute.Number}
                  textAlign={ObcInputTextAlign.Left}
                  noHorisontalPadding
                  value={String(heading)}
                  disabled={!editMode}
                  onInput={(event) =>
                    onSettingsChange({ heading: parseNumberInput(event, heading) })
                  }
                />
              </label>

              {shapeMode === "wedge" ? (
                <>
                  <label className="ais-map-panel__field">
                    <span>Range</span>
                    <ObcInput
                      type={HTMLInputTypeAttribute.Number}
                      textAlign={ObcInputTextAlign.Left}
                      noHorisontalPadding
                      value={String(offsetMeters)}
                      disabled={!editMode}
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
                      textAlign={ObcInputTextAlign.Left}
                      noHorisontalPadding
                      value={String(fovDegrees)}
                      disabled={!editMode}
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
                      className="ais-map-panel__input"
                      type={HTMLInputTypeAttribute.Number}
                      textAlign={ObcInputTextAlign.Left}
                      noHorisontalPadding
                      value={String(rectLength)}
                      disabled={!editMode}
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
                      className="ais-map-panel__input"
                      type={HTMLInputTypeAttribute.Number}
                      textAlign={ObcInputTextAlign.Left}
                      noHorisontalPadding
                      value={String(rectWidth)}
                      disabled={!editMode}
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

            <div className="ais-map-panel__area-shape">
              <span className="ais-map-panel__inline-label">Area shape</span>
              <ObcToggleButtonGroup
                value={shapeMode}
                type={ObcToggleButtonOptionType.text}
                disabled={!editMode}
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

            <div className="ais-map-panel__area-actions">
              {editMode ? (
                <div className="ais-map-panel__actions">
                  <ObcButton variant={ButtonVariant.normal} fullWidth onClick={handleCancelEditing}>
                    Cancel
                  </ObcButton>
                  <ObcButton variant={ButtonVariant.raised} fullWidth onClick={handleSaveEditing}>
                    Save
                  </ObcButton>
                </div>
              ) : (
                <ObcButton
                  className="ais-map-panel__edit-area-button"
                  variant={ButtonVariant.normal}
                  onClick={handleStartEditing}
                >
                  Edit area
                </ObcButton>
              )}
            </div>
          </div>
        </>
      )}

      <button
        type="button"
        className="ais-map-panel__expand-toggle"
        aria-label={isExpanded ? "Minimize AIS controls" : "Expand AIS controls"}
        aria-expanded={isExpanded}
        onClick={handleToggleExpanded}
      >
        {isExpanded ? <ObiContentCollapseGoogle /> : <ObiContentExpandGoogle />}
      </button>
    </aside>
  );
};
