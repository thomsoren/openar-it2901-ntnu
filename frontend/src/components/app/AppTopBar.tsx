import { ObcTopBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/top-bar/top-bar";
import { ObcClock } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/clock/clock";

interface AppTopBarProps {
  pageLabel: string;
  clockDate: string;
  isOnAuthGate: boolean;
  showNavigationMenu: boolean;
  showUserPanel: boolean;
  onToggleNavigationMenu: () => void;
  onToggleBrillianceMenu: () => void;
  onToggleUserPanel: () => void;
}

export function AppTopBar({
  pageLabel,
  clockDate,
  isOnAuthGate,
  showNavigationMenu,
  showUserPanel,
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
