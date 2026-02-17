import React, { useState } from "react";
import { useFetchAISGeographicalData } from "../hooks/useFetchAISGeographicalData";
import "./AISGeographicalDataDisplay.css";
import { AISData } from "../types/aisData";
import { ObcInput } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/input/input";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcStatusIndicator } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/status-indicator/status-indicator";
import { ObcTag } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tag/tag";
import { ObcElevatedCard } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/elevated-card/elevated-card";
import { AISGeoJsonMap } from "./AISGeoJsonMap/AISGeoJsonMap";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";

export const AISGeographicalDataDisplay: React.FC = () => {
  const [shouldStream, setShouldStream] = useState(false);
  const [shipLat, setShipLat] = useState(63.4365);
  const [shipLon, setShipLon] = useState(10.3835);
  const [heading, setHeading] = useState(0);
  const [offsetMeters, setOffsetMeters] = useState(1000);
  const [fovDegrees, setFovDegrees] = useState(60);
  const [isLoadingGPS, setIsLoadingGPS] = useState(false);

  const parseNumberInput = (event: Event, fallback: number) => {
    const rawValue = (event.target as { value?: string }).value ?? "";
    const parsedValue = Number.parseFloat(rawValue);
    return Number.isNaN(parsedValue) ? fallback : parsedValue;
  };

  const { features, isStreaming, error } = useFetchAISGeographicalData(
    shouldStream,
    shipLat,
    shipLon,
    heading,
    offsetMeters,
    fovDegrees
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

  return (
    <div className="ais-stream-container">
      <div className="ais-stream-header">
        <div className="ais-stream-title">
          <h2>Live AIS Data Stream</h2>
          <div className="ais-stream-meta">
            {/* @ts-expect-error - OpenBridge component type mismatch */}
            <ObcStatusIndicator status={isStreaming ? "running" : "inactive"}>
              {isStreaming ? "Streaming" : "Idle"}
            </ObcStatusIndicator>
            {error && (
              /* @ts-expect-error - OpenBridge component type mismatch */
              <ObcStatusIndicator status="alarm">Error: {error}</ObcStatusIndicator>
            )}
            {/* @ts-expect-error - OpenBridge component type mismatch */}
            <ObcTag label={`Vessels received: ${features.length}`} color="blue" />
          </div>
        </div>

        <div className="ais-stream-controls">
          {/* @ts-expect-error - OpenBridge component type mismatch */}
          <ObcButton variant="raised" onClick={() => setShouldStream(true)} disabled={isStreaming}>
            Start Stream
          </ObcButton>
          {/* @ts-expect-error - OpenBridge component type mismatch */}
          <ObcButton variant="flat" onClick={() => setShouldStream(false)} disabled={!isStreaming}>
            Stop
          </ObcButton>
        </div>
      </div>

      <div className="ais-stream-params">
        <div className="param-group">
          <span className="param-label">Ship Latitude</span>
          <ObcInput
            /* @ts-expect-error - OpenBridge component type mismatch */
            type="number"
            value={String(shipLat)}
            placeholder="63.4365"
            disabled={isStreaming}
            aria-label="Ship latitude"
            onInput={(e) => setShipLat(parseNumberInput(e, shipLat))}
          />
        </div>
        <div className="param-group">
          <span className="param-label">Ship Longitude</span>
          <ObcInput
            /* @ts-expect-error - OpenBridge component type mismatch */
            type="number"
            value={String(shipLon)}
            placeholder="10.3835"
            disabled={isStreaming}
            aria-label="Ship longitude"
            onInput={(e) => setShipLon(parseNumberInput(e, shipLon))}
          />
        </div>
        <div className="param-group">
          <span className="param-label">Heading (°)</span>
          <ObcInput
            /* @ts-expect-error - OpenBridge component type mismatch */
            type="number"
            value={String(heading)}
            placeholder="0"
            disabled={isStreaming}
            aria-label="Heading in degrees"
            onInput={(e) => setHeading(parseNumberInput(e, heading))}
          />
        </div>
        <div className="param-group">
          <span className="param-label">Range (m)</span>
          <ObcInput
            /* @ts-expect-error - OpenBridge component type mismatch */
            type="number"
            value={String(offsetMeters)}
            placeholder="1000"
            disabled={isStreaming}
            aria-label="Range in meters"
            onInput={(e) => setOffsetMeters(parseNumberInput(e, offsetMeters))}
          />
        </div>
        <div className="param-group">
          <span className="param-label">FOV (°)</span>
          <ObcInput
            /* @ts-expect-error - OpenBridge component type mismatch */
            type="number"
            value={String(fovDegrees)}
            placeholder="60"
            disabled={isStreaming}
            aria-label="Field of view in degrees"
            onInput={(e) => setFovDegrees(parseNumberInput(e, fovDegrees))}
          />
        </div>
        <div className="param-group">
          <span className="param-label">Autofill GPS coordinates</span>
          <ObcButton
            variant={ButtonVariant.normal}
            onClick={handleUseGPSLocation}
            disabled={isStreaming || isLoadingGPS}
          >
            {isLoadingGPS ? "Fetching..." : "Current position"}
          </ObcButton>
        </div>
      </div>

      <AISGeoJsonMap
        shipLat={shipLat}
        shipLon={shipLon}
        heading={heading}
        offsetMeters={offsetMeters}
        fovDegrees={fovDegrees}
        onChange={(updates) => {
          if (updates.shipLat !== undefined) setShipLat(updates.shipLat);
          if (updates.shipLon !== undefined) setShipLon(updates.shipLon);
          if (updates.heading !== undefined) setHeading(updates.heading);
          if (updates.offsetMeters !== undefined) setOffsetMeters(updates.offsetMeters);
        }}
      />

      <div className="ais-stream-list">
        {features.length === 0 ? (
          <div className="empty-state">
            <p>No AIS data yet. Configure parameters and click Start Stream.</p>
          </div>
        ) : (
          <div className="features-grid">
            {features.map((feature: AISData) => (
              <ObcElevatedCard
                key={`${feature.mmsi}-${feature.msgtime}`}
                className="feature-card"
                /* @ts-expect-error - OpenBridge component type mismatch */
                size="multi-line"
                notClickable
              >
                <div slot="label" className="feature-label">
                  <span className="feature-name">
                    {feature?.name || feature?.mmsi || "Unknown Vessel"}
                  </span>
                  <ObcTag
                    label={feature?.mmsi ? `MMSI ${feature.mmsi}` : "MMSI N/A"}
                    /* @ts-expect-error - OpenBridge component type mismatch */
                    color="blue"
                  />
                </div>
                <div slot="description" className="feature-details">
                  {feature?.latitude !== undefined && feature?.longitude !== undefined && (
                    <div className="feature-detail">
                      <span className="feature-detail-label">Position</span>
                      <span className="feature-detail-value">
                        {Number(feature.latitude).toFixed(4)},{" "}
                        {Number(feature.longitude).toFixed(4)}
                      </span>
                    </div>
                  )}
                  {feature?.navigationalStatus !== undefined && (
                    <div className="feature-detail">
                      <span className="feature-detail-label">Status</span>
                      <span className="feature-detail-value">{feature.navigationalStatus}</span>
                    </div>
                  )}
                  {feature?.speedOverGround !== undefined && (
                    <div className="feature-detail">
                      <span className="feature-detail-label">Speed</span>
                      <span className="feature-detail-value">{feature.speedOverGround} knots</span>
                    </div>
                  )}
                  {feature?.courseOverGround !== undefined && (
                    <div className="feature-detail">
                      <span className="feature-detail-label">Course</span>
                      <span className="feature-detail-value">{feature.courseOverGround}°</span>
                    </div>
                  )}
                  {feature?.trueHeading !== undefined && (
                    <div className="feature-detail">
                      <span className="feature-detail-label">Heading</span>
                      <span className="feature-detail-value">{feature.trueHeading}°</span>
                    </div>
                  )}
                  {feature?.msgtime && (
                    <div className="feature-detail">
                      <span className="feature-detail-label">Last Update</span>
                      <span className="feature-detail-value">{feature.msgtime}</span>
                    </div>
                  )}
                </div>
              </ObcElevatedCard>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
