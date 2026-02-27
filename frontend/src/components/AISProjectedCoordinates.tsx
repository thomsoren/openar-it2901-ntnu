import React, { useState } from "react";
import type { AISData, AISProjection } from "../types/aisData";
import { useFetchAISGeographicalData } from "../hooks/useFetchAISGeographicalData";
import "./AISProjectedCoordinates.css";
import { ObcInput } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/input/input";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcStatusIndicator } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/status-indicator/status-indicator";
import { ObcTag } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tag/tag";
import { ObcElevatedCard } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/elevated-card/elevated-card";
import { useFetchHistoricalMmsiInArea } from "../hooks/useFetchHistoricalMmsiInArea";
import { buildFovPolygon } from "../utils/geometryMath";

/** Type guard: narrows AISData to ensure projection is non-null. */
function hasProjection(f: AISData): f is AISData & { projection: AISProjection } {
  return f.projection != null;
}
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

export const AISProjectedCoordinates: React.FC = () => {
  const [shouldStream, setShouldStream] = useState(false);
  const [shipLat, setShipLat] = useState(63.4365);
  const [shipLon, setShipLon] = useState(10.3835);
  const [heading, setHeading] = useState(90);
  const [offsetMeters, setOffsetMeters] = useState(3000);
  const [fovDegrees, setFovDegrees] = useState(120);
  const [msgTimeFrom, setMsgTimeFrom] = useState("");
  const [msgTimeTo, setMsgTimeTo] = useState("");

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

  const {
    mmsis: historicalMmsis,
    isLoading: isHistoricalLoading,
    error: historicalError,
    fetchMmsis: fetchHistoricalMmsis,
  } = useFetchHistoricalMmsiInArea();

  const handleHistoricQuery = () => {
    const polygonCoords = buildFovPolygon(shipLat, shipLon, heading, offsetMeters, fovDegrees);
    fetchHistoricalMmsis({
      polygon: { type: "Polygon", coordinates: [polygonCoords] },
      msgTimeFrom,
      msgTimeTo,
      ship_lat: shipLat,
      ship_lon: shipLon,
      heading: heading,
      log: true,
    });
  };

  const visibleFeatures = features.filter(hasProjection);

  return (
    <div className="projection-container">
      <div className="projection-header">
        <div className="projection-title">
          <h2>AIS Projected Coordinates</h2>
          <div className="projection-meta">
            {/* @ts-expect-error - OpenBridge component type mismatch */}
            <ObcStatusIndicator status={isStreaming ? "running" : "inactive"}>
              {isStreaming ? "Streaming" : "Idle"}
            </ObcStatusIndicator>
            {error && (
              /* @ts-expect-error - OpenBridge component type mismatch */
              <ObcStatusIndicator status="alarm">Error: {error}</ObcStatusIndicator>
            )}
            {/* @ts-expect-error - OpenBridge component type mismatch */}
            <ObcTag label={`In FOV: ${visibleFeatures.length}`} color="blue" />
          </div>
        </div>

        <div className="projection-controls">
          {/* @ts-expect-error - OpenBridge component type mismatch */}
          <ObcButton variant="raised" onClick={() => setShouldStream(true)} disabled={isStreaming}>
            Start Stream
          </ObcButton>
          {/* @ts-expect-error - OpenBridge component type mismatch */}
          <ObcButton variant="flat" onClick={() => setShouldStream(false)} disabled={!isStreaming}>
            Stop
          </ObcButton>
          {/* @ts-expect-error - OpenBridge component type mismatch */}
          <ObcButton variant="flat" onClick={handleHistoricQuery} disabled={isHistoricalLoading}>
            {isHistoricalLoading
              ? "Loading…"
              : `Historic${historicalMmsis.length ? ` (${historicalMmsis.length})` : ""}`}
          </ObcButton>
          {historicalError && (
            /* @ts-expect-error - OpenBridge component type mismatch */
            <ObcStatusIndicator status="alarm">
              Historic error: {historicalError}
            </ObcStatusIndicator>
          )}
        </div>
      </div>

      <div className="projection-params">
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
            placeholder="90"
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
            placeholder="3000"
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
            placeholder="120"
            disabled={isStreaming}
            aria-label="Field of view in degrees"
            onInput={(e) => setFovDegrees(parseNumberInput(e, fovDegrees))}
          />
        </div>
        <div className="param-group">
          <span className="param-label">From (UTC)</span>
          <ObcInput
            /* @ts-expect-error - OpenBridge component type mismatch */
            type="text"
            value={msgTimeFrom}
            placeholder="2026-01-01T08:00:00Z"
            aria-label="Historic query start time (ISO-8601 UTC)"
            onInput={(e) => setMsgTimeFrom((e.target as { value?: string }).value ?? "")}
          />
        </div>
        <div className="param-group">
          <span className="param-label">To (UTC)</span>
          <ObcInput
            /* @ts-expect-error - OpenBridge component type mismatch */
            type="text"
            value={msgTimeTo}
            placeholder="2026-01-01T08:15:00Z"
            aria-label="Historic query end time (ISO-8601 UTC)"
            onInput={(e) => setMsgTimeTo((e.target as { value?: string }).value ?? "")}
          />
        </div>
      </div>

      <div className="projection-canvas-section">
        <div className="canvas-wrapper">
          <svg
            className="projection-canvas"
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          >
            {/* Background */}
            <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="#1a1a1a" />

            {/* Grid lines */}
            {[...Array(5)].map((_, i) => {
              const x = ((i + 1) * CANVAS_WIDTH) / 6;
              return (
                <line
                  key={`v${i}`}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={CANVAS_HEIGHT}
                  stroke="#444"
                  strokeWidth="1"
                  opacity="0.5"
                />
              );
            })}
            {[...Array(3)].map((_, i) => {
              const y = ((i + 1) * CANVAS_HEIGHT) / 4;
              return (
                <line
                  key={`h${i}`}
                  x1={0}
                  y1={y}
                  x2={CANVAS_WIDTH}
                  y2={y}
                  stroke="#444"
                  strokeWidth="1"
                  opacity="0.5"
                />
              );
            })}

            {/* Center crosshair */}
            <line
              x1={CANVAS_WIDTH / 2}
              y1={0}
              x2={CANVAS_WIDTH / 2}
              y2={CANVAS_HEIGHT}
              stroke="#0f0"
              strokeWidth="2"
              opacity="0.3"
            />
            <line
              x1={0}
              y1={CANVAS_HEIGHT / 2}
              x2={CANVAS_WIDTH}
              y2={CANVAS_HEIGHT / 2}
              stroke="#0f0"
              strokeWidth="2"
              opacity="0.3"
            />

            {/* Projected points */}
            {visibleFeatures.map((feature) => (
              <g key={feature.mmsi}>
                {/* Points */}
                <circle
                  cx={feature.projection.x_px}
                  cy={feature.projection.y_px}
                  r="8"
                  fill="#00ff00"
                  opacity="0.8"
                />
                <circle
                  cx={feature.projection.x_px}
                  cy={feature.projection.y_px}
                  r="12"
                  fill="none"
                  stroke="#00ff00"
                  strokeWidth="2"
                  opacity="0.5"
                />

                {/* Label */}
                <text
                  x={feature.projection.x_px + 15}
                  y={feature.projection.y_px - 5}
                  fill="#00ff00"
                  fontSize="14"
                  fontFamily="monospace"
                  opacity="0.9"
                >
                  {feature.name || `MMSI ${feature.mmsi}`}
                </text>
              </g>
            ))}
          </svg>
        </div>

        <div className="projection-data-list">
          {visibleFeatures.length === 0 ? (
            <div className="empty-state">
              <p>No vessels in field of view. Configure parameters and click Start Stream.</p>
            </div>
          ) : (
            <div className="data-grid">
              {visibleFeatures.map((feature) => (
                <ObcElevatedCard
                  key={feature.mmsi}
                  className="data-card"
                  /* @ts-expect-error - OpenBridge component type mismatch */
                  size="multi-line"
                  notClickable
                >
                  <div slot="label" className="data-label">
                    <span className="data-name">{feature.name || `MMSI ${feature.mmsi}`}</span>
                    <ObcTag
                      label={`${feature.mmsi}`}
                      /* @ts-expect-error - OpenBridge component type mismatch */
                      color="blue"
                    />
                  </div>
                  <div slot="description" className="data-details">
                    <div className="data-detail">
                      <span className="data-detail-label">Pixel Position</span>
                      <span className="data-detail-value">
                        ({Math.round(feature.projection.x_px)},{" "}
                        {Math.round(feature.projection.y_px)})
                      </span>
                    </div>
                    <div className="data-detail">
                      <span className="data-detail-label">Distance</span>
                      <span className="data-detail-value">
                        {Math.round(feature.projection.distance_m)} m
                      </span>
                    </div>
                    <div className="data-detail">
                      <span className="data-detail-label">Bearing</span>
                      <span className="data-detail-value">
                        {feature.projection.bearing_deg.toFixed(1)}°
                      </span>
                    </div>
                    <div className="data-detail">
                      <span className="data-detail-label">Rel. Bearing</span>
                      <span className="data-detail-value">
                        {feature.projection.rel_bearing_deg.toFixed(1)}°
                      </span>
                    </div>
                  </div>
                </ObcElevatedCard>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
