import { ObcElevatedCard } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/elevated-card/elevated-card";
import { ObcTag } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/tag/tag";
import { ObcElevatedCardSize } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/elevated-card/elevated-card";
import { TagColor } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/tag/tag";
import { StreamPerformanceSnapshot } from "../../hooks/streamPerformanceMetrics";
import "./StreamPerformancePanel.css";

interface StreamPerformancePanelProps {
  title?: string;
  transportLabel?: string;
  snapshot: StreamPerformanceSnapshot;
}

const formatMetric = (value: number | null, digits = 1, suffix = ""): string => {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${value.toFixed(digits)}${suffix}`;
};

export function StreamPerformancePanel({
  title = "Performance telemetry",
  transportLabel,
  snapshot,
}: StreamPerformancePanelProps) {
  const videoMetrics = [
    { label: "Rendered FPS", value: formatMetric(snapshot.videoFps) },
    { label: "Behind real time", value: formatMetric(snapshot.videoLatencyMs, 0, " ms") },
    {
      label: "Receive to display",
      value: formatMetric(snapshot.videoReceiveToDisplayLatencyMs, 0, " ms"),
    },
    {
      label: "Dropped frames",
      value: `${snapshot.videoDroppedFrames ?? "n/a"}${
        snapshot.videoDroppedRate !== null
          ? ` (${formatMetric(snapshot.videoDroppedRate, 1, "%")})`
          : ""
      }`,
    },
  ];
  const detectionMetrics = [
    { label: "Inference FPS", value: formatMetric(snapshot.detectionFps) },
    { label: "Delivery FPS", value: formatMetric(snapshot.detectionDeliveryFps) },
    {
      label: "Pipeline latency",
      value: formatMetric(snapshot.detectionPipelineLatencyMs, 0, " ms"),
    },
    {
      label: "Browser transport",
      value: formatMetric(snapshot.detectionTransportLatencyMs, 0, " ms"),
    },
    {
      label: "Current detection age",
      value: formatMetric(snapshot.detectionTotalLatencyMs, 0, " ms"),
    },
    {
      label: "Detection behind video",
      value: formatMetric(snapshot.detectionBehindVideoMs, 0, " ms"),
    },
    {
      label: "Decode queue",
      value: formatMetric(snapshot.detectionDecodeQueueLatencyMs, 0, " ms"),
    },
    {
      label: "Inference time",
      value: formatMetric(snapshot.detectionInferenceLatencyMs, 0, " ms"),
    },
    {
      label: "Publish time",
      value: formatMetric(snapshot.detectionPublishLatencyMs, 0, " ms"),
    },
  ];

  return (
    <aside className="stream-performance-panel" aria-label={title}>
      <ObcElevatedCard
        className="stream-performance-panel__card stream-performance-panel__card--header"
        size={ObcElevatedCardSize.MultiLine}
        notClickable
      >
        <div slot="label" className="stream-performance-panel__card-title">
          <span>{title}</span>
          {transportLabel ? <ObcTag label={transportLabel} color={TagColor.blue} /> : null}
        </div>
        <div slot="description" className="stream-performance-panel__card-description">
          Live browser and detection timing for the active stream.
        </div>
      </ObcElevatedCard>

      <ObcElevatedCard
        className="stream-performance-panel__card"
        size={ObcElevatedCardSize.MultiLine}
        notClickable
      >
        <div slot="label" className="stream-performance-panel__section-title">
          Video
        </div>
        <div slot="description" className="stream-performance-panel__grid">
          {videoMetrics.map((metric) => (
            <div key={metric.label} className="stream-performance-panel__metric">
              <span className="stream-performance-panel__label">{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>
      </ObcElevatedCard>

      <ObcElevatedCard
        className="stream-performance-panel__card"
        size={ObcElevatedCardSize.MultiLine}
        notClickable
      >
        <div slot="label" className="stream-performance-panel__section-title">
          Detection
        </div>
        <div slot="description" className="stream-performance-panel__grid">
          {detectionMetrics.map((metric) => (
            <div key={metric.label} className="stream-performance-panel__metric">
              <span className="stream-performance-panel__label">{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>
      </ObcElevatedCard>
    </aside>
  );
}

export default StreamPerformancePanel;
