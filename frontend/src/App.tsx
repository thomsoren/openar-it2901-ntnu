import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/openbridge.css";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/user-menu/user-menu";
import { ObcTopBar } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/top-bar/top-bar";
import { ObcBrillianceMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/brilliance-menu/brilliance-menu";
import { ObcClock } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/clock/clock";
import { ObcNavigationMenu } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-menu/navigation-menu";
import { ObcNavigationItem } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/navigation-item/navigation-item";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcElevatedCard } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/elevated-card/elevated-card";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { ObcElevatedCardSize } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/elevated-card/elevated-card";
import "./App.css";
import Ais from "./pages/Ais";
import Fusion from "./pages/Fusion";
import Components from "./pages/Components";
import Datavision from "./pages/Datavision";
import Settings from "./pages/Settings";
import Upload from "./pages/Upload";
import AuthGate from "./components/auth/AuthGate";
import AccessDenied from "./components/auth/AccessDenied";
import { useClock } from "./hooks/useClock";
import { useNavigation } from "./hooks/useNavigation";
import { useAuth } from "./hooks/useAuth";
import { useUserMenu } from "./hooks/useUserMenu";

const handleBrillianceChange = (event: CustomEvent) => {
  document.documentElement.setAttribute("data-obc-theme", event.detail.value);
};

function App() {
  const { clockDate } = useClock();
  const nav = useNavigation();
  const auth = useAuth(nav.currentPage);
  const { profileMenuRef } = useUserMenu({
    showUserPanel: nav.showUserPanel,
    userMenuState: auth.userMenuState,
    userInitials: auth.userInitials,
    userLabel: auth.userLabel,
    signedInActions: auth.signedInActions,
    profileUsername: auth.profileUsername,
    profilePassword: auth.profilePassword,
    handleProfileSignIn: auth.handleProfileSignIn,
    handleSignOut: auth.handleSignOut,
  });

  const renderPublicPage = () => {
    if (nav.currentPage === "datavision") {
      return <Datavision />;
    }

    if (nav.currentPage === "ais") {
      return <Ais />;
    }

    if (nav.currentPage === "components") {
      return <Components />;
    }

    if (nav.currentPage === "fusion") {
      return <Fusion />;
    }

    return <Settings />;
  };

  const renderUploadPage = () => {
    if (!auth.session) {
      return <AuthGate initialMode={nav.authGateMode} onAuthenticated={auth.handleAuthenticated} />;
    }

    if (auth.isSessionPending) {
      return (
        <div className="app-auth-feedback">
          <ObcElevatedCard size={ObcElevatedCardSize.MultiLine}>
            <div slot="label">Checking session</div>
            <div slot="description">Loading authentication state for Upload...</div>
          </ObcElevatedCard>
        </div>
      );
    }

    if (auth.authBridgeStatus === "error") {
      return (
        <div className="app-auth-feedback">
          <ObcElevatedCard size={ObcElevatedCardSize.MultiLine}>
            <div slot="label">Authentication error</div>
            <div slot="description">
              {auth.authBridgeError || "Unable to initialize upload access."}
            </div>
          </ObcElevatedCard>
          <div className="app-auth-feedback__actions">
            <ObcButton variant={ButtonVariant.raised} onClick={auth.retryAuthBridge}>
              Retry
            </ObcButton>
            <ObcButton
              variant={ButtonVariant.flat}
              disabled={auth.isSigningOut}
              onClick={() => void auth.handleSignOut()}
            >
              {auth.isSigningOut ? "Signing out..." : "Sign out"}
            </ObcButton>
          </div>
        </div>
      );
    }

    if (
      auth.authBridgeStatus === "loading" ||
      auth.authBridgeStatus === "idle" ||
      !auth.backendUser
    ) {
      return (
        <div className="app-auth-feedback">
          <ObcElevatedCard size={ObcElevatedCardSize.MultiLine}>
            <div slot="label">Authenticating upload access</div>
            <div slot="description">Establishing API session...</div>
          </ObcElevatedCard>
        </div>
      );
    }

    if (!auth.backendUser.is_admin) {
      return <AccessDenied />;
    }

    return <Upload currentUser={auth.backendUser} />;
  };

  return (
    <>
      <header>
        <ObcTopBar
          appTitle="OpenAR"
          pageName={nav.pageLabels[nav.currentPage]}
          showDimmingButton
          showUserButton={!(nav.currentPage === "upload" && !auth.session)}
          showClock
          menuButtonActivated={nav.showNavigationMenu}
          userButtonActivated={nav.showUserPanel}
          onMenuButtonClicked={() => nav.setShowNavigationMenu((previous) => !previous)}
          onDimmingButtonClicked={() => {
            nav.setShowUserPanel(false);
            nav.setShowBrillianceMenu((previous) => !previous);
          }}
          onUserButtonClicked={() => {
            nav.setShowBrillianceMenu(false);
            nav.setShowUserPanel((previous) => !previous);
          }}
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

      {nav.showUserPanel && (
        <div className={`user-panel${!auth.session ? " user-panel--auth" : ""}`}>
          {auth.session ? (
            <obc-user-menu
              ref={profileMenuRef}
              type={auth.userMenuState}
              size="small"
              username={auth.profileUsername}
              password={auth.profilePassword}
            />
          ) : (
            <AuthGate
              initialMode="login"
              onAuthenticated={async () => {
                nav.setShowUserPanel(false);
                await auth.handleAuthenticated();
              }}
            />
          )}
        </div>
      )}

      {nav.showNavigationMenu && (
        <ObcNavigationMenu className="navigation-menu">
          <div slot="main">
            <ObcNavigationItem
              label="Fusion"
              checked={nav.currentPage === "fusion"}
              onClick={() => nav.handleNavigationItemClick("fusion")}
            />
            <ObcNavigationItem
              label="Datavision"
              checked={nav.currentPage === "datavision"}
              onClick={() => nav.handleNavigationItemClick("datavision")}
            />
            <ObcNavigationItem
              label="AIS"
              checked={nav.currentPage === "ais"}
              onClick={() => nav.handleNavigationItemClick("ais")}
            />
            <ObcNavigationItem
              label="Components"
              checked={nav.currentPage === "components"}
              onClick={() => nav.handleNavigationItemClick("components")}
            />
            <ObcNavigationItem
              label="Settings"
              checked={nav.currentPage === "settings"}
              onClick={() => nav.handleNavigationItemClick("settings")}
            />
            <ObcNavigationItem
              label="Upload"
              checked={nav.currentPage === "upload"}
              onClick={() => nav.handleNavigationItemClick("upload")}
            />
          </div>
        </ObcNavigationMenu>
      )}

      <main
        className={[
          "main",
          nav.showNavigationMenu ? "main--with-sidebar" : "",
          nav.currentPage === "components" ? "main--no-padding" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {nav.showBrillianceMenu && (
          <ObcBrillianceMenu
            onPaletteChanged={handleBrillianceChange}
            show-auto-brightness
            className="brilliance"
          />
        )}

        {nav.currentPage === "upload" ? renderUploadPage() : renderPublicPage()}
      </main>
    </>
  );
}

export default App;
