import { ObcTopBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/top-bar/top-bar";
import { ObcClock } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/clock/clock";
import { ObcAlertIcon } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/alert-icon/alert-icon";
import { ObcTopbarMessageItem } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/topbar-message-item/topbar-message-item";
import {
  ObcTopbarMessageItemSize,
  ObcTopbarMessageItemType,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/topbar-message-item/topbar-message-item";
import { AlertType } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/types";

interface AppTopBarProps {
  pageLabel: string;
  clockDate: string;
  isOnAuthGate: boolean;
  alertCount: number;
  alertTitle: string;
  alertDescription: string;
  showAlertPanel: boolean;
  showNavigationMenu: boolean;
  showUserPanel: boolean;
  onAckFirstAlert: () => void;
  onToggleAlertPanel: () => void;
  onToggleNavigationMenu: () => void;
  onToggleBrillianceMenu: () => void;
  onToggleUserPanel: () => void;
}

export function AppTopBar({
  pageLabel,
  clockDate,
  isOnAuthGate,
  alertCount,
  alertTitle,
  alertDescription,
  showAlertPanel,
  showNavigationMenu,
  showUserPanel,
  onAckFirstAlert,
  onToggleAlertPanel,
  onToggleNavigationMenu,
  onToggleBrillianceMenu,
  onToggleUserPanel,
}: AppTopBarProps) {
  return (
    <header>
      <ObcTopBar
        appTitle="OpenAR"
        pageName={pageLabel}
        showDimmingButton
        showUserButton
        userButtonDisabled={isOnAuthGate}
        showClock
        menuButtonActivated={showNavigationMenu}
        userButtonActivated={showUserPanel}
        onMenuButtonClicked={onToggleNavigationMenu}
        onDimmingButtonClicked={onToggleBrillianceMenu}
        onUserButtonClicked={onToggleUserPanel}
      >
        {alertCount > 0 && (
          <ObcTopbarMessageItem
            slot="alerts"
            type={ObcTopbarMessageItemType.WithButton}
            size={ObcTopbarMessageItemSize.Regular}
            onMessageClick={onToggleAlertPanel}
            onActionClick={onAckFirstAlert}
            aria-expanded={showAlertPanel}
            aria-label={alertCount > 0 ? `${alertCount} active alerts` : "No active alerts"}
          >
            <ObcAlertIcon slot="primary-icon" type={AlertType.Alarm} active acknowledged={false} />
            <div slot="title">{alertTitle}</div>
            <div slot="description">{alertDescription}</div>
            <div slot="time">
              {new Date(clockDate).toLocaleTimeString("nb-NO", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </div>
            <div slot="action-text">ACK</div>
          </ObcTopbarMessageItem>
        )}
        <ObcClock
          slot="clock"
          date={clockDate}
          timeZoneOffsetHours={new Date(clockDate).getTimezoneOffset() / -60}
          showTimezone
          blinkOnlyBreakpointPx={600}
        />
      </ObcTopBar>
    </header>
  );
}
