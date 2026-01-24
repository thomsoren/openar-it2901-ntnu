import React, { useState } from "react";
import { useFetchAISGeographicalData } from "../hooks/useFetchAISGeographicalData";
import "./AISGeographicalDataDisplay.css";
import { AISData } from "../types/AisData";
import { ObcInput } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/input/input";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcStatusIndicator } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/status-indicator/status-indicator";
import { ObcTag } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tag/tag";
import { ObcElevatedCard } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/elevated-card/elevated-card";

export const AISGeographicalDataDisplay: React.FC = () => {
  const [shouldStream, setShouldStream] = useState(false);
  const [shipLat, setShipLat] = useState(63.4365);
  const [shipLon, setShipLon] = useState(10.3835);
  const [heading, setHeading] = useState(0);
  const [offsetMeters, setOffsetMeters] = useState(1000);
  const [fovDegrees, setFovDegrees] = useState(60);

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

  return (
    <div className="ais-stream-container">
      <div className="ais-stream-header">
        <div className="ais-stream-title">
          <h2>Live AIS Data Stream</h2>
          <div className="ais-stream-meta">
            <ObcStatusIndicator status={isStreaming ? "running" : "inactive"}>
              {isStreaming ? "Streaming" : "Idle"}
            </ObcStatusIndicator>
            {error && <ObcStatusIndicator status="alarm">Error: {error}</ObcStatusIndicator>}
            <ObcTag label={`Vessels received: ${features.length}`} color="blue" />
          </div>
        </div>

        <div className="ais-stream-controls">
          <ObcButton variant="raised" onClick={() => setShouldStream(true)} disabled={isStreaming}>
            Start Stream
          </ObcButton>
          <ObcButton variant="flat" onClick={() => setShouldStream(false)} disabled={!isStreaming}>
            Stop
          </ObcButton>
        </div>
      </div>

      <div className="ais-stream-params">
        <div className="param-group">
          <span className="param-label">Ship Latitude</span>
          <ObcInput
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
            type="number"
            value={String(fovDegrees)}
            placeholder="60"
            disabled={isStreaming}
            aria-label="Field of view in degrees"
            onInput={(e) => setFovDegrees(parseNumberInput(e, fovDegrees))}
          />
        </div>
      </div>

      <div className="ais-stream-list">
        {features.length === 0 ? (
          <div className="empty-state">
            <p>No AIS data yet. Configure parameters and click Start Stream.</p>
          </div>
        ) : (
          <div className="features-grid">
            {features.map((feature: AISData, idx) => (
              <ObcElevatedCard key={idx} className="feature-card" size="multi-line" notClickable>
                <div slot="label" className="feature-label">
                  <span className="feature-name">
                    {feature?.name || feature?.mmsi || "Unknown Vessel"}
                  </span>
                  <ObcTag
                    label={feature?.mmsi ? `MMSI ${feature.mmsi}` : "MMSI N/A"}
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
