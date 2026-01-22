import React, { useState } from "react";
import { useFetchAISStream } from "../hooks/useFetchAISStream";
import "./AISStreamDisplay.css";

interface AISData {
  courseOverGround: number;
  latitude: number;
  longitude: number;
  name: string;
  rateOfTurn: number;
  shipType: number;
  speedOverGround: number;
  trueHeading: number;
  navigationalStatus: number;
  mmsi: number;
  msgtime: string;
}

/**
 * Component that displays AIS data stream on demand
 * Click a button to start streaming for specified duration
 */
export const AISStreamDisplay: React.FC = () => {
  const [duration, setDuration] = useState(10);
  const [shouldStream, setShouldStream] = useState(false);
  const { features, isStreaming, error } = useFetchAISStream(shouldStream, duration);

  const handleStartStream = (seconds: number) => {
    setDuration(seconds);
    setShouldStream(true);
  };

  const handleStopStream = () => {
    setShouldStream(false);
  };

  return (
    <div className="ais-stream-container">
      <div className="ais-stream-header">
        <h2>Live AIS Data Stream</h2>
        <div className="ais-stream-controls">
          <button
            onClick={() => handleStartStream(10)}
            disabled={isStreaming}
            className="btn btn-primary"
          >
            Start 10s
          </button>
          <button
            onClick={() => handleStartStream(30)}
            disabled={isStreaming}
            className="btn btn-primary"
          >
            Start 30s
          </button>
          <button
            onClick={handleStopStream}
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
        <p>Vessels received: <strong>{features.length}</strong></p>
      </div>

      <div className="ais-stream-list">
        {features.length === 0 ? (
          <div className="empty-state">
            <p>No AIS data yet. Click a button above to start streaming.</p>
          </div>
        ) : (
          <div className="features-grid">
            {features.map((feature: AISData, idx) => (
              <div key={idx} className="feature-card">
                <div className="feature-header">
                  <h4>{feature.name || "Unknown Vessel"}</h4>
                  <span className="mmsi">MMSI: {feature.mmsi}</span>
                </div>
                <div className="feature-details">
                  <p>
                    <strong>Position:</strong> {feature.latitude.toFixed(4)}, {feature.longitude.toFixed(4)}
                  </p>
                  <p>
                    <strong>Status:</strong> {feature.navigationalStatus}
                  </p>
                  <p>
                    <strong>Speed:</strong> {feature.speedOverGround} knots
                  </p>
                  <p>
                    <strong>Course:</strong> {feature.courseOverGround}°
                  </p>
                  <p>
                    <strong>Heading:</strong> {feature.trueHeading}°
                  </p>
                  <p>
                    <strong>Last Update:</strong> {feature.msgtime}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
