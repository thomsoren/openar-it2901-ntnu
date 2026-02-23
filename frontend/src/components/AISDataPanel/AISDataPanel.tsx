import { AISData } from "../../types/aisData";
import "./AISDataPanel.css";

// Maps AIS data fields to display labels and formatting functions
type AISLabeledFields = {
  label: string;
  format: (vessel: AISData) => string | number | undefined | null;
};
// The order of this array determines the display order in the panel
const AIS_DATA_LABELS: AISLabeledFields[] = [
  { label: "MMSI", format: (v) => v.mmsi },
  { label: "Name", format: (v) => v.name },
  { label: "Latitude", format: (v) => v.latitude?.toFixed(5) },
  { label: "Longitude", format: (v) => v.longitude?.toFixed(5) },
  {
    label: "COG",
    format: (v) => (v.courseOverGround != null ? `${v.courseOverGround}°` : undefined),
  },
  {
    label: "SOG",
    format: (v) => (v.speedOverGround != null ? `${v.speedOverGround} kn` : undefined),
  },
  {
    label: "True Heading",
    format: (v) => (v.trueHeading != null ? `${v.trueHeading}°` : undefined),
  },
  { label: "ROT", format: (v) => (v.rateOfTurn != null ? `${v.rateOfTurn}°/min` : undefined) },
  { label: "Nav Status", format: (v) => v.navigationalStatus },
  { label: "Ship Type", format: (v) => v.shipType },
  {
    label: "Last Update",
    format: (v) => (v.msgtime ? new Date(v.msgtime).toLocaleString() : undefined),
  },
];

interface AISDataPanelProps {
  vessel: AISData;
  onClose: () => void;
}

export const AISDataPanel: React.FC<AISDataPanelProps> = ({ vessel, onClose }) => (
  <div className="geojson-map-vessel-panel">
    <div className="geojson-map-vessel-panel-header">
      <span>{vessel.name || "Unknown Vessel"}</span>
      <button className="geojson-map-vessel-panel-close" onClick={onClose}>
        ✕
      </button>
    </div>
    <div className="geojson-map-vessel-panel-body">
      {AIS_DATA_LABELS.map(({ label, format }) => ({ label, value: format(vessel) }))
        .filter(({ value }) => value != null && value !== "")
        .map(({ label, value }) => (
          <div key={label} className="geojson-map-vessel-panel-row">
            <span className="geojson-map-vessel-panel-label">{label}</span>
            <span className="geojson-map-vessel-panel-value">{String(value)}</span>
          </div>
        ))}
    </div>
  </div>
);
