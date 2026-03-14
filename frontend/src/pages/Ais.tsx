import { useState } from "react";
import { useFetchAISGeographicalData } from "../hooks/useFetchAISGeographicalData";
import { AISGeoJsonMap } from "../components/AISGeoJsonMap/AISGeoJsonMap";
import { AISMapParameterPanel } from "../components/AISMapParameterPanel/AISMapParameterPanel";
import type { AISMapParameterSettings } from "../components/AISMapParameterPanel/AISMapParameterPanel";
import type { VesselIconSet } from "../utils/vesselIconMapper";
import "./Ais.css";

// Clamp coordinades to fewer decimals to avoid excessive precision
const clampCoordinatePrecision = (value: number): number => Number(value.toFixed(6));

function Ais() {
  const [shipLat, setShipLat] = useState(63.4365);
  const [shipLon, setShipLon] = useState(10.3835);
  const [heading, setHeading] = useState(0);
  const [offsetMeters, setOffsetMeters] = useState(1000);
  const [fovDegrees, setFovDegrees] = useState(60);
  const [shapeMode, setShapeMode] = useState<"wedge" | "rect">("wedge");
  const [rectLength, setRectLength] = useState(1000);
  const [rectWidth, setRectWidth] = useState(600);
  const [editMode, setEditMode] = useState(false);
  const [iconSet, setIconSet] = useState<VesselIconSet>("generic");
  const [isLoadingGPS, setIsLoadingGPS] = useState(false);

  const { features } = useFetchAISGeographicalData(
    true,
    shipLat,
    shipLon,
    heading,
    offsetMeters,
    fovDegrees,
    shapeMode,
    rectLength,
    rectWidth
  );

  const handleUseGPSLocation = () => {
    setIsLoadingGPS(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setShipLat(clampCoordinatePrecision(position.coords.latitude));
        setShipLon(clampCoordinatePrecision(position.coords.longitude));
        setIsLoadingGPS(false);
      },
      (gpsError) => {
        console.error("Location unavailable", gpsError);
        setIsLoadingGPS(false);
      }
    );
  };

  const panelSettings: AISMapParameterSettings = {
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
  };

  const handlePanelSettingsChange = (updates: Partial<AISMapParameterSettings>) => {
    if (updates.shipLat !== undefined) setShipLat(clampCoordinatePrecision(updates.shipLat));
    if (updates.shipLon !== undefined) setShipLon(clampCoordinatePrecision(updates.shipLon));
    if (updates.heading !== undefined) setHeading(updates.heading);
    if (updates.offsetMeters !== undefined) setOffsetMeters(updates.offsetMeters);
    if (updates.fovDegrees !== undefined) setFovDegrees(updates.fovDegrees);
    if (updates.shapeMode !== undefined) setShapeMode(updates.shapeMode);
    if (updates.rectLength !== undefined) setRectLength(updates.rectLength);
    if (updates.rectWidth !== undefined) setRectWidth(updates.rectWidth);
    if (updates.editMode !== undefined) setEditMode(updates.editMode);
    if (updates.iconSet !== undefined) setIconSet(updates.iconSet);
  };

  return (
    <div className="ais-page">
      <div className="ais-page__live-view">
        <AISGeoJsonMap
          shipLat={shipLat}
          shipLon={shipLon}
          heading={heading}
          offsetMeters={offsetMeters}
          fovDegrees={fovDegrees}
          shapeMode={shapeMode}
          rectLength={rectLength}
          rectWidth={rectWidth}
          editMode={editMode}
          iconSet={iconSet}
          vessels={features}
          onChange={(updates) => {
            if (updates.shipLat !== undefined)
              setShipLat(clampCoordinatePrecision(updates.shipLat));
            if (updates.shipLon !== undefined)
              setShipLon(clampCoordinatePrecision(updates.shipLon));
            if (updates.heading !== undefined) setHeading(updates.heading);
            if (updates.offsetMeters !== undefined) setOffsetMeters(updates.offsetMeters);
            if (updates.fovDegrees !== undefined) setFovDegrees(updates.fovDegrees);
            if (updates.shapeMode !== undefined) setShapeMode(updates.shapeMode);
            if (updates.rectLength !== undefined) setRectLength(updates.rectLength);
            if (updates.rectWidth !== undefined) setRectWidth(updates.rectWidth);
          }}
        />

        <div className="ais-page__panel-wrap">
          <AISMapParameterPanel
            settings={panelSettings}
            isLoadingGPS={isLoadingGPS}
            onUseGPSLocation={handleUseGPSLocation}
            onSettingsChange={handlePanelSettingsChange}
          />
        </div>
      </div>
    </div>
  );
}

export default Ais;
