import React, { useState } from "react";
import { useFetchAISGeographicalData } from "../hooks/useFetchAISGeographicalData";
import "./AISGeographicalDataDisplay.css";
import { AISGeoJsonMap } from "./AISGeoJsonMap/AISGeoJsonMap";
import { AISMapParameterPanel } from "./AISMapParameterPanel/AISMapParameterPanel";
import type { AISMapParameterSettings } from "./AISMapParameterPanel/AISMapParameterPanel";
import type { VesselIconSet } from "../utils/vesselIconMapper";

export const AISGeographicalDataDisplay: React.FC = () => {
  const [shouldStream, setShouldStream] = useState(false);
  const [shipLat, setShipLat] = useState(63.4365);
  const [shipLon, setShipLon] = useState(10.3835);
  const [heading, setHeading] = useState(0);
  const [offsetMeters, setOffsetMeters] = useState(1000);
  const [fovDegrees, setFovDegrees] = useState(60);
  const [shapeMode, setShapeMode] = useState<"wedge" | "rect">("wedge");
  const [rectLength, setRectLength] = useState(1000);
  const [rectWidth, setRectWidth] = useState(600);
  const [editMode, setEditMode] = useState(true);
  const [iconSet, setIconSet] = useState<VesselIconSet>("generic");
  const [isLoadingGPS, setIsLoadingGPS] = useState(false);

  const { features, isStreaming, error } = useFetchAISGeographicalData(
    shouldStream,
    shipLat,
    shipLon,
    heading,
    offsetMeters,
    fovDegrees,
    shapeMode,
    rectLength,
    rectWidth
  );

  // Get browser GPS location to autofill ship position
  const handleUseGPSLocation = () => {
    setIsLoadingGPS(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setShipLat(position.coords.latitude);
        setShipLon(position.coords.longitude);
        setIsLoadingGPS(false);
      },
      (error) => {
        console.error("Location unavailable", error);
        setIsLoadingGPS(false);
      }
    );
  };

  // Bundle panel settings into a single object for easier passing to the panel component
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

  // Helper to handle settings changes from the panel and update corresponding state variables
  const handlePanelSettingsChange = (updates: Partial<AISMapParameterSettings>) => {
    if (updates.shipLat !== undefined) setShipLat(updates.shipLat);
    if (updates.shipLon !== undefined) setShipLon(updates.shipLon);
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
    <div className="ais-live-view">
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
          if (updates.shipLat !== undefined) setShipLat(updates.shipLat);
          if (updates.shipLon !== undefined) setShipLon(updates.shipLon);
          if (updates.heading !== undefined) setHeading(updates.heading);
          if (updates.offsetMeters !== undefined) setOffsetMeters(updates.offsetMeters);
          if (updates.fovDegrees !== undefined) setFovDegrees(updates.fovDegrees);
          if (updates.shapeMode !== undefined) setShapeMode(updates.shapeMode);
          if (updates.rectLength !== undefined) setRectLength(updates.rectLength);
          if (updates.rectWidth !== undefined) setRectWidth(updates.rectWidth);
        }}
      />

      <div className="ais-live-view__panel-wrap">
        <AISMapParameterPanel
          streamState={{
            isStreaming,
            isLoadingGPS,
            error: error ?? undefined,
            vesselCount: features.length,
          }}
          settings={panelSettings}
          onSetShouldStream={setShouldStream}
          onUseGPSLocation={handleUseGPSLocation}
          onSettingsChange={handlePanelSettingsChange}
        />
      </div>
    </div>
  );
};
