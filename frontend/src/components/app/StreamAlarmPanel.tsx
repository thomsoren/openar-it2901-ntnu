import { useCallback } from "react";
import { ObcAlertMenuItem } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/alert-menu-item/alert-menu-item";
import { ObcAlertMenuItemStatus } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/alert-menu-item/alert-menu-item";
import { ObcMessageMenuItemSize } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/message-menu-item/message-menu-item";
import { ObcAlertIcon } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/alert-icon/alert-icon";
import { AlertType } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/types";
import { ObiAlarmNoackIec } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-alarm-noack-iec";
import type { StreamAlert } from "../../utils/streamAlerts";

interface StreamAlarmPanelProps {
  alerts: StreamAlert[];
  dismissed: Set<string>;
  onDismiss: (id: string) => void;
}

export function StreamAlarmPanel({ alerts, dismissed, onDismiss }: StreamAlarmPanelProps) {
  const handleAck = useCallback((id: string) => onDismiss(id), [onDismiss]);

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) {
    return null;
  }

  return (
    <aside className="stream-alarm-panel" aria-live="polite" aria-label="Stream alarms">
      {visible.map((alert) => (
        <ObcAlertMenuItem
          key={alert.id}
          className="stream-alarm-panel__item"
          title={alert.title}
          description={alert.recovery ? `${alert.detail} ${alert.recovery}` : alert.detail}
          status={ObcAlertMenuItemStatus.Unacknowledged}
          size={ObcMessageMenuItemSize.DoubleLine}
          onAckClick={() => handleAck(alert.id)}
          open
        >
          <ObcAlertIcon slot="alert-icon" type={AlertType.Alarm} active acknowledged={false} />
          <ObiAlarmNoackIec slot="icon" useCssColor />
        </ObcAlertMenuItem>
      ))}
    </aside>
  );
}
