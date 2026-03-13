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

  return (
    <aside className="stream-alarm-panel" aria-live="polite" aria-label="Stream alarms">
      <ObcAlertMenu>
        {visible.map((alert) => (
          <ObcAlertMenuItem
            key={alert.id}
            title={alert.title}
            description={alert.recovery ? `${alert.detail} ${alert.recovery}` : alert.detail}
            time={new Date().toISOString()}
            status={ObcAlertMenuItemStatus.Unacknowledged}
            size={ObcMessageMenuItemSize.DoubleLine}
            hasIcon
            open
            onAckClick={() => onDismiss(alert.id)}
          >
            {alert.source === "data" ? (
              <ObiWarningUnacknowledgedIec slot="icon" useCssColor />
            ) : alert.source === "system" ? (
              <ObiCautionColorIec slot="icon" useCssColor />
            ) : (
              <ObiAlarmUnacknowledgedIec slot="icon" useCssColor />
            )}
          </ObcAlertMenuItem>
        ))}
      </ObcAlertMenu>
    </aside>
  );
}
