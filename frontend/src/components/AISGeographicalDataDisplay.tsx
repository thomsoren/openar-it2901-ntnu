import React, { useState } from "react";
import { useFetchAISGeographicalData } from "../hooks/useFetchAISGeographicalData";
import "./AISGeographicalDataDisplay.css";
import { AISData } from "../types/AisData";

export const AISGeographicalDataDisplay: React.FC = () => {
  const [shouldStream, setShouldStream] = useState(false);
  const [shipLat, setShipLat] = useState(63.4365);
  const [shipLon, setShipLon] = useState(10.3835);
  const [heading, setHeading] = useState(0);
  const [offsetMeters, setOffsetMeters] = useState(1000);
  const [fovDegrees, setFovDegrees] = useState(60);

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
        <h2>Live AIS Data Stream</h2>

        <div className="ais-stream-params">
          <div className="param-group">
            <label>Ship Latitude:</label>
            <input
              type="number"
              step="0.0001"
              value={shipLat}
              onChange={(e) => setShipLat(parseFloat(e.target.value))}
              disabled={isStreaming}
            />
          </div>
          <div className="param-group">
            <label>Ship Longitude:</label>
            <input
              type="number"
              step="0.0001"
              value={shipLon}
              onChange={(e) => setShipLon(parseFloat(e.target.value))}
              disabled={isStreaming}
            />
          </div>
          <div className="param-group">
            <label>Heading (°):</label>
            <input
              type="number"
              min="0"
              max="360"
              value={heading}
              onChange={(e) => setHeading(parseFloat(e.target.value))}
              disabled={isStreaming}
            />
          </div>
          <div className="param-group">
            <label>Range (m):</label>
            <input
              type="number"
              min="100"
              max="10000"
              step="100"
              value={offsetMeters}
              onChange={(e) => setOffsetMeters(parseFloat(e.target.value))}
              disabled={isStreaming}
            />
          </div>
          <div className="param-group">
            <label>FOV (°):</label>
            <input
              type="number"
              min="10"
              max="180"
              step="10"
              value={fovDegrees}
              onChange={(e) => setFovDegrees(parseFloat(e.target.value))}
              disabled={isStreaming}
            />
          </div>
        </div>

        <div className="ais-stream-controls">
          <button
            onClick={() => setShouldStream(true)}
            disabled={isStreaming}
            className="btn btn-primary"
          >
            Start Stream
          </button>
          <button
            onClick={() => setShouldStream(false)}
            disabled={!isStreaming}
            className="btn btn-danger"
          >
            Stop
          </button>
        </div>
      </div>

      <div className="ais-stream-status">
        {isStreaming ? (
          <span className="status-badge streaming">● Streaming...</span>
        ) : (
          <span className="status-badge idle">○ Idle</span>
        )}
        {error && <span className="status-error">Error: {error}</span>}
      </div>

      <div className="ais-stream-stats">
        <p>
          Vessels received: <strong>{features.length}</strong>
        </p>
      </div>

      <div className="ais-stream-list">
        {features.length === 0 ? (
          <div className="empty-state">
            <p>No AIS data yet. Configure parameters and click Start Stream.</p>
          </div>
        ) : (
          <div className="features-grid">
            {features.map((feature: AISData, idx) => (
              <div key={idx} className="feature-card">
                <div className="feature-header">
                  <h4>{feature?.name || feature?.mmsi || "Unknown Vessel"}</h4>
                  <span className="mmsi">MMSI: {feature?.mmsi || "N/A"}</span>
                </div>
                <div className="feature-details">
                  {feature?.latitude !== undefined && feature?.longitude !== undefined && (
                    <p>
                      <strong>Position:</strong> {Number(feature.latitude).toFixed(4)},{" "}
                      {Number(feature.longitude).toFixed(4)}
                    </p>
                  )}
                  {feature?.navigationalStatus !== undefined && (
                    <p>
                      <strong>Status:</strong> {feature.navigationalStatus}
                    </p>
                  )}
                  {feature?.speedOverGround !== undefined && (
                    <p>
                      <strong>Speed:</strong> {feature.speedOverGround} knots
                    </p>
                  )}
                  {feature?.courseOverGround !== undefined && (
                    <p>
                      <strong>Course:</strong> {feature.courseOverGround}°
                    </p>
                  )}
                  {feature?.trueHeading !== undefined && (
                    <p>
                      <strong>Heading:</strong> {feature.trueHeading}°
                    </p>
                  )}
                  {feature?.msgtime && (
                    <p>
                      <strong>Last Update:</strong> {feature.msgtime}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
