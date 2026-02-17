import React, { useState } from "react";
import { useFetchAISProjections } from "../hooks/useFetchAISProjections";
import "./AISProjectedCoordinates.css";
import { ObcInput } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/input/input";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcStatusIndicator } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/status-indicator/status-indicator";
import { ObcTag } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tag/tag";
import { ObcElevatedCard } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/elevated-card/elevated-card";
import { useFetchAISProjectionsByMMSI } from "../hooks/useFetchAISProjectionsByMMSI";

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

export const AISProjectedCoordinates: React.FC = () => {
  const [mode, setMode] = useState<"manual" | "mmsi">("manual");
  const [shouldStream, setShouldStream] = useState(false);

  // Manual mode parameters
  const [shipLat, setShipLat] = useState(63.4365);
  const [shipLon, setShipLon] = useState(10.3835);
  const [heading, setHeading] = useState(90);
  const [offsetMeters, setOffsetMeters] = useState(3000);
  const [fovDegrees, setFovDegrees] = useState(120);

  // MMSI mode parameters
  const [mmsi, setMMSI] = useState("257347700"); // LISE example

  const parseNumberInput = (event: Event, fallback: number) => {
    const rawValue = (event.target as { value?: string }).value ?? "";
    const parsedValue = Number.parseFloat(rawValue);
    return Number.isNaN(parsedValue) ? fallback : parsedValue;
  };

  // Fetch data based on mode
  const manualResult = useFetchAISProjections(
    shouldStream && mode === "manual",
    shipLat,
    shipLon,
    heading,
    offsetMeters,
    fovDegrees
  );

  const mmsiResult = useFetchAISProjectionsByMMSI(
    shouldStream && mode === "mmsi",
    mmsi,
    offsetMeters,
    fovDegrees
  );

  const { projections, isStreaming, error } = mode === "manual" ? manualResult : mmsiResult;

  const visibleProjections = projections.filter((p) => p.in_fov);

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
            <ObcTag label={`In FOV: ${visibleProjections.length}`} color="blue" />
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
        </div>
      </div>

      <div className="projection-params">
        <div className="param-group">
          <span className="param-label">Mode</span>
          <div className="mode-buttons">
            <ObcButton
              // @ts-expect-error - OpenBridge component type mismatch
              variant={mode === "manual" ? "raised" : "flat"}
              onClick={() => {
                setMode("manual");
                setShouldStream(false);
              }}
              disabled={isStreaming}
            >
              Manual Position
            </ObcButton>
            <ObcButton
              // @ts-expect-error - OpenBridge component type mismatch
              variant={mode === "mmsi" ? "raised" : "flat"}
              onClick={() => {
                setMode("mmsi");
                setShouldStream(false);
              }}
              disabled={isStreaming}
            >
              MMSI Lookup
            </ObcButton>
          </div>
        </div>

        {mode === "manual" ? (
          <>
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
          </>
        ) : (
          <div className="param-group">
            <span className="param-label">MMSI</span>
            <ObcInput
              /* @ts-expect-error - OpenBridge component type mismatch */
              type="text"
              value={mmsi}
              placeholder="257347700"
              disabled={isStreaming}
              aria-label="Maritime Mobile Service Identity"
              onInput={(e) => setMMSI((e.target as { value?: string }).value ?? "")}
            />
          </div>
        )}

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
            {visibleProjections.map((proj) => (
              <g key={`${proj.mmsi}`}>
                {/* Points */}
                <circle cx={proj.pixel_x} cy={proj.pixel_y} r="8" fill="#00ff00" opacity="0.8" />
                <circle
                  cx={proj.pixel_x}
                  cy={proj.pixel_y}
                  r="12"
                  fill="none"
                  stroke="#00ff00"
                  strokeWidth="2"
                  opacity="0.5"
                />

                {/* Label */}
                <text
                  x={proj.pixel_x + 15}
                  y={proj.pixel_y - 5}
                  fill="#00ff00"
                  fontSize="14"
                  fontFamily="monospace"
                  opacity="0.9"
                >
                  {proj.name || `MMSI ${proj.mmsi}`}
                </text>
              </g>
            ))}
          </svg>
        </div>

        <div className="projection-data-list">
          {visibleProjections.length === 0 ? (
            <div className="empty-state">
              <p>No vessels in field of view. Configure parameters and click Start Stream.</p>
            </div>
          ) : (
            <div className="data-grid">
              {visibleProjections.map((proj) => (
                <ObcElevatedCard
                  key={`${proj.mmsi}`}
                  className="data-card"
                  /* @ts-expect-error - OpenBridge component type mismatch */
                  size="multi-line"
                  notClickable
                >
                  <div slot="label" className="data-label">
                    <span className="data-name">{proj.name || `MMSI ${proj.mmsi}`}</span>
                    <ObcTag
                      label={`${proj.mmsi}`}
                      /* @ts-expect-error - OpenBridge component type mismatch */
                      color="blue"
                    />
                  </div>
                  <div slot="description" className="data-details">
                    <div className="data-detail">
                      <span className="data-detail-label">Pixel Position</span>
                      <span className="data-detail-value">
                        ({Math.round(proj.pixel_x)}, {Math.round(proj.pixel_y)})
                      </span>
                    </div>
                    <div className="data-detail">
                      <span className="data-detail-label">Distance</span>
                      <span className="data-detail-value">{Math.round(proj.distance_m)} m</span>
                    </div>
                    <div className="data-detail">
                      <span className="data-detail-label">Bearing</span>
                      <span className="data-detail-value">{proj.bearing_deg.toFixed(1)}°</span>
                    </div>
                    <div className="data-detail">
                      <span className="data-detail-label">Rel. Bearing</span>
                      <span className="data-detail-value">
                        {proj.relative_bearing_deg.toFixed(1)}°
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
