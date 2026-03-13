import { ObcTopBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/top-bar/top-bar";
import { ObcClock } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/clock/clock";
import { ObcAlertButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/alert-button/alert-button";
import { ObcAlertButtonType } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/alert-button/alert-button";
import { AlertType } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/types";

interface AppTopBarProps {
  pageLabel: string;
  clockDate: string;
  isOnAuthGate: boolean;
  alertCount: number;
  showAlertPanel: boolean;
  showNavigationMenu: boolean;
  showUserPanel: boolean;
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
  showAlertPanel,
  showNavigationMenu,
  showUserPanel,
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
        <ObcAlertButton
          slot="alerts"
          nAlerts={alertCount}
          alertType={alertCount > 0 ? AlertType.Alarm : undefined}
          counter
          blinking={alertCount > 0}
          type={ObcAlertButtonType.Normal}
          onClickAlert={onToggleAlertPanel}
          aria-expanded={showAlertPanel}
          aria-label={alertCount > 0 ? `${alertCount} active alerts` : "No active alerts"}
        />
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
