import { ObcAlertMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/alert-menu/alert-menu";
import { ObcAlertMenuItem } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/alert-menu-item/alert-menu-item";
import { ObcAlertMenuItemStatus } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/alert-menu-item/alert-menu-item";
import { ObcMessageMenuItemSize } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/message-menu-item/message-menu-item";
import { ObiAlarmUnacknowledgedIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-alarm-unacknowledged-iec";
import { ObiCautionColorIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-caution-color-iec";
import { ObiWarningUnacknowledgedIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-warning-unacknowledged-iec";
import type { StreamAlert } from "../../utils/streamAlerts";

interface StreamAlarmPanelProps {
  alerts: StreamAlert[];
  dismissed: Set<string>;
  onDismiss: (id: string) => void;
}

export function StreamAlarmPanel({ alerts, dismissed, onDismiss }: StreamAlarmPanelProps) {
  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) {
    return null;
  }
  const timeLabel = new Intl.DateTimeFormat("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());

  return (
    <aside className="stream-alarm-panel" aria-live="polite" aria-label="Stream alarms">
      <ObcAlertMenu
        canAckAll
        onAckAllVisibleClick={() => {
          visible.forEach((alert) => onDismiss(alert.id));
        }}
      >
        {visible.map((alert) => (
          <ObcAlertMenuItem
            key={alert.id}
            title={alert.title}
            description={alert.recovery ? `${alert.detail} ${alert.recovery}` : alert.detail}
            time={timeLabel}
            status={ObcAlertMenuItemStatus.Unacknowledged}
            size={ObcMessageMenuItemSize.DoubleLine}
            onAckClick={() => onDismiss(alert.id)}
          >
            {alert.source === "data" ? (
              <ObiWarningUnacknowledgedIec slot="alert-icon" useCssColor />
            ) : alert.source === "system" ? (
              <ObiCautionColorIec slot="alert-icon" useCssColor />
            ) : (
              <ObiAlarmUnacknowledgedIec slot="alert-icon" useCssColor />
            )}
          </ObcAlertMenuItem>
        ))}
      </ObcAlertMenu>
    </aside>
  );
}
