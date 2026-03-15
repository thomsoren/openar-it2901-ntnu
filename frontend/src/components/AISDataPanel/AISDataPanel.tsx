import { useEffect, useRef, type CSSProperties } from "react";
import { AISData } from "../../types/aisData";
import getVesselIcon, { type VesselIconSet } from "../../utils/vesselIconMapper";
import "./AISDataPanel.css";
import { distanceTo } from "../../utils/geometryMath";
import { ObcPoiCard } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/ar/poi-card/poi-card";
import { ObcBearingIndicator } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/navigation-instruments/bearing-indicator/bearing-indicator";
import {
  ObcPoiCard as ObcPoiCardElement,
  ObcPoiCardHeaderVariant,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/ar/poi-card/poi-card";

// Requires lat & long from origin vessel to calculate distance,
// but other fields are optional for future CPA (closest point of approach) calculations or other use cases
type OriginVesselData = Pick<AISData, "latitude" | "longitude"> &
  Partial<Omit<AISData, "latitude" | "longitude">>;

interface AISDataPanelProps {
  vessel: AISData;
  originVessel: OriginVesselData;
  onClose: () => void;
  onIconClick?: () => void;
  selectedIndex?: number;
  useAISData?: boolean;
  iconSet?: VesselIconSet;
}

const formatMetric = (value: number | null | undefined, digits = 1): string => {
  if (value == null || !Number.isFinite(value)) {
    return "N/A";
  }
  return value.toFixed(digits);
};

const formatRelativeTime = (msgtime?: string): string => {
  if (!msgtime) {
    return "Unknown time";
  }

  const timestamp = new Date(msgtime);
  if (Number.isNaN(timestamp.getTime())) {
    return "Unknown time";
  }

  const deltaMinutes = Math.round((Date.now() - timestamp.getTime()) / 60000);

  if (deltaMinutes < 1) {
    return "Just now";
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes} min ago`;
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours} h ago`;
  }

  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays} d ago`;
};

const isValidAngle = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 360;

const normalizeAngle = (value: number): number => ((value % 360) + 360) % 360;

const getVesselIconRotation = (vessel: AISData): number => {
  if (isValidAngle(vessel.trueHeading)) {
    return normalizeAngle(vessel.trueHeading);
  }

  if (isValidAngle(vessel.courseOverGround)) {
    return normalizeAngle(vessel.courseOverGround);
  }

  return 0;
};

export const AISDataPanel: React.FC<AISDataPanelProps> = ({
  vessel,
  originVessel,
  onClose,
  onIconClick,
  selectedIndex,
  useAISData,
  iconSet = "generic",
}) => {
  const cardRef = useRef<ObcPoiCardElement | null>(null);

  // Listen for the custom "close-click" event from the ObcPoiCard to trigger onClose callback
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const handleCloseClick = (event: Event) => {
      event.stopPropagation();
      onClose();
    };

    el.addEventListener("close-click", handleCloseClick);
    return () => {
      el.removeEventListener("close-click", handleCloseClick);
    };
  }, [onClose]);

  // Calculate range from origin vessel to target vessel in meters
  const rangeMeters = distanceTo(
    vessel.latitude,
    vessel.longitude,
    originVessel.latitude,
    originVessel.longitude
  ).toFixed(0);

  // Format vessel data for display, with fallbacks for missing values
  const statusBadge = vessel.navigationalStatus ?? "-";
  const relativeTime = formatRelativeTime(vessel.msgtime);
  const bearing = formatMetric(vessel.courseOverGround, 0);
  const heading = formatMetric(vessel.trueHeading, 0);
  const speed = formatMetric(vessel.speedOverGround);
  const rot = formatMetric(vessel.rateOfTurn);
  const vesselIconRotation = getVesselIconRotation(vessel);
  const slotIconStyle = {
    "--ais-poi-icon-rotation": `${vesselIconRotation}deg`,
  } as CSSProperties;
  const bearingDeg = vesselIconRotation;

  return (
    <div className="ais-poi-panel">
      <ObcPoiCard
        ref={cardRef}
        className="ais-poi-card"
        index={String(selectedIndex ?? statusBadge)}
        cardTitle={vessel.name || "Unknown vessel"}
        description={`MMSI ${vessel.mmsi || "N/A"}`}
        source={useAISData ? "AIS" : "SRC"}
        timestamp={relativeTime}
        headerVariant={ObcPoiCardHeaderVariant.Detailed}
        hasCloseButton
      >
        <span
          slot="poi-icon"
          className="ais-poi-slot-icon"
          style={slotIconStyle}
          role={onIconClick ? "button" : undefined}
          tabIndex={onIconClick ? 0 : undefined}
          onClick={() => onIconClick?.()}
          onKeyDown={(event) => {
            if (!onIconClick) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onIconClick();
            }
          }}
        >
          {getVesselIcon(vessel, { iconSet, returnType: "icon" })}
        </span>

        {useAISData ? (
          <div className="ais-poi-body">
            <div className="ais-poi-primary-row">
              <div className="ais-poi-primary-direction">
                <div className="obc-component-size-regular">
                  <ObcBearingIndicator bearingDeg={bearingDeg} />
                </div>
              </div>

              <div className="ais-poi-primary-metric">
                <span className="ais-poi-primary-value">{bearing}</span>
                <span className="ais-poi-primary-meta">
                  <strong>BRG</strong>
                  <br />
                  DEG
                </span>
              </div>
              <div className="ais-poi-primary-metric">
                <span className="ais-poi-primary-value">{rangeMeters}</span>
                <span className="ais-poi-primary-meta">
                  <strong>RNG</strong>
                  <br />m
                </span>
              </div>
            </div>

            <div className="ais-poi-secondary-row">
              <div className="ais-poi-secondary-col">
                <p>
                  <span className="ais-poi-secondary-label">ROT</span>
                  <span className="ais-poi-secondary-value">
                    <strong>{rot}</strong> DEG
                  </span>
                </p>
                <p>
                  <span className="ais-poi-secondary-label">THD</span>
                  <span className="ais-poi-secondary-value">
                    <strong>{heading}</strong> DEG
                  </span>
                </p>
              </div>
              <div className="ais-poi-secondary-col">
                <p>
                  <span className="ais-poi-secondary-label">HDG</span>
                  <span className="ais-poi-secondary-value">
                    <strong>{heading}</strong> DEG
                  </span>
                </p>
                <p>
                  <span className="ais-poi-secondary-label">SPD</span>
                  <span className="ais-poi-secondary-value">
                    <strong>{speed}</strong> kn
                  </span>
                </p>
              </div>
            </div>
          </div>
        ) : (
          <p>No AIS data available for this vessel.</p>
        )}
      </ObcPoiCard>
    </div>
  );
};
