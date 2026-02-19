import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import Upload, { BackendUser } from "./pages/Upload";
import { authClient } from "./lib/auth-client";
import { apiFetch, apiFetchPublic, clearApiAccessToken, setApiAccessToken } from "./lib/api-client";
import AuthGate from "./components/auth/AuthGate";
import AccessDenied from "./components/auth/AccessDenied";

const PAGE_STORAGE_KEY = "openar.currentPage";
const PAGES = ["datavision", "ais", "components", "fusion", "settings", "upload"] as const;
type PageId = (typeof PAGES)[number];

type AuthBridgeStatus = "idle" | "loading" | "ready" | "error";
type AuthGateMode = "login" | "signup";
type UserMenuState = "sign-in" | "loading-sign-in" | "signed-in";
type UserMenuSignInDetail = {
  username?: string;
  password?: string;
};
type UserMenuAction = {
  id: string;
  label: string;
};

const getStoredPage = (): PageId => {
  try {
    const stored = localStorage.getItem(PAGE_STORAGE_KEY) as PageId | null;
    if (stored && PAGES.includes(stored)) {
      return stored;
    }
  } catch {
    // Ignore storage failures.
  }
  return "datavision";
};

const handleBrillianceChange = (event: CustomEvent) => {
  document.documentElement.setAttribute("data-obc-theme", event.detail.value);
};

const readApiError = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { detail?: string };
    return payload.detail || fallback;
  } catch {
    return fallback;
  }
};

const normalizeUsername = (value: string) => value.trim().toLowerCase();

const getInitials = (value?: string | null) => {
  if (!value) {
    return "U";
  }

  const tokens = value.trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return "U";
  }

  const initials =
    tokens.length === 1 ? tokens[0].slice(0, 2) : `${tokens[0][0] || ""}${tokens[1][0] || ""}`;

  return initials.toUpperCase();
};

function App() {
  const [showBrillianceMenu, setShowBrillianceMenu] = useState(false);
  const [showNavigationMenu, setShowNavigationMenu] = useState(false);
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [currentPage, setCurrentPage] = useState<PageId>(() => getStoredPage());
  const [authGateMode, setAuthGateMode] = useState<AuthGateMode>("login");

  const [backendUser, setBackendUser] = useState<BackendUser | null>(null);
  const [authBridgeStatus, setAuthBridgeStatus] = useState<AuthBridgeStatus>("idle");
  const [authBridgeError, setAuthBridgeError] = useState("");
  const [authBootstrapNonce, setAuthBootstrapNonce] = useState(0);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isProfileSigningIn, setIsProfileSigningIn] = useState(false);
  const [profileUsername, setProfileUsername] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [profileUsernameError, setProfileUsernameError] = useState("");
  const [profilePasswordError, setProfilePasswordError] = useState("");
  const profileMenuRef = useRef<HTMLElement | null>(null);

  const {
    data: session,
    isPending: isSessionPending,
    refetch: refetchSession,
  } = authClient.useSession();

  const pageLabels = {
    datavision: "Datavision",
    ais: "AIS",
    components: "Components",
    fusion: "Fusion",
    settings: "Settings",
    upload: "Upload",
  } as const;
  const sessionUsername = (session?.user as { username?: string } | undefined)?.username;
  const signedInActions = useMemo<UserMenuAction[]>(() => [{ id: "noop", label: "" }], []);
  const userLabel = sessionUsername || session?.user?.name || session?.user?.email || "User";
  const userInitials = useMemo(() => getInitials(userLabel), [userLabel]);
  const userMenuState: UserMenuState =
    isProfileSigningIn || isSigningOut || isSessionPending
      ? "loading-sign-in"
      : session
        ? "signed-in"
        : "sign-in";

  useEffect(() => {
    try {
      localStorage.setItem(PAGE_STORAGE_KEY, currentPage);
    } catch {
      // Ignore storage failures.
    }
  }, [currentPage]);

  useEffect(() => {
    if (!session?.user?.id) {
      clearApiAccessToken();
      setBackendUser(null);
      setAuthBridgeStatus("idle");
      setAuthBridgeError("");
      return;
    }

    if (currentPage !== "upload") {
      return;
    }

    let cancelled = false;

    const bootstrapBackendAuth = async () => {
      setAuthBridgeStatus("loading");
      setAuthBridgeError("");

      try {
        const exchangeResponse = await apiFetchPublic("/auth/token/exchange", {
          method: "POST",
        });

        if (!exchangeResponse.ok) {
          throw new Error(await readApiError(exchangeResponse, "Failed to exchange token"));
        }

        const exchangePayload = (await exchangeResponse.json()) as {
          access_token: string;
        };

        setApiAccessToken(exchangePayload.access_token);

        const meResponse = await apiFetch("/auth/me");
        if (!meResponse.ok) {
          throw new Error(await readApiError(meResponse, "Failed to load user profile"));
        }

        const mePayload = (await meResponse.json()) as { user: BackendUser };

        if (cancelled) {
          return;
        }

        setBackendUser(mePayload.user);
        setAuthBridgeStatus("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }

        clearApiAccessToken();
        setBackendUser(null);
        setAuthBridgeStatus("error");
        setAuthBridgeError(error instanceof Error ? error.message : "Authentication bridge failed");
      }
    };

    void bootstrapBackendAuth();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, currentPage, authBootstrapNonce]);

  const handleNavigationItemClick = (page: PageId) => {
    setCurrentPage(page);
    if (page === "upload") {
      setAuthGateMode("login");
    }
    setShowNavigationMenu(false);
    setShowUserPanel(false);
  };

  const handleAuthenticated = async () => {
    await refetchSession();
    setAuthBootstrapNonce((previous) => previous + 1);
  };

  const retryAuthBridge = () => {
    setAuthBootstrapNonce((previous) => previous + 1);
  };

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);

    try {
      await Promise.allSettled([
        authClient.signOut(),
        apiFetchPublic("/auth/logout", {
          method: "POST",
        }),
      ]);
    } finally {
      clearApiAccessToken();
      setBackendUser(null);
      await refetchSession();
      setAuthBootstrapNonce((previous) => previous + 1);
      setIsSigningOut(false);
    }
  }, [refetchSession]);

  const handleProfileSignIn = useCallback(
    async (rawUsername: string, rawPassword: string) => {
      const normalizedUsername = normalizeUsername(rawUsername);

      setProfileUsername(normalizedUsername);
      setProfilePassword(rawPassword);
      setProfileUsernameError("");
      setProfilePasswordError("");
      setIsProfileSigningIn(true);

      try {
        const response = await authClient.signIn.username({
          username: normalizedUsername,
          password: rawPassword,
        });

        if (response.error) {
          throw new Error(response.error.message || "Invalid username or password");
        }

        setProfilePassword("");
        await refetchSession();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Authentication failed";
        const lower = message.toLowerCase();

        if (lower.includes("networkerror") || lower.includes("failed to fetch")) {
          setProfilePasswordError("Authentication service unavailable");
        } else if (lower.includes("invalid") || lower.includes("credentials")) {
          setProfilePasswordError("Invalid username or password");
        } else {
          setProfilePasswordError(message);
        }
      } finally {
        setIsProfileSigningIn(false);
      }
    },
    [refetchSession]
  );

  useEffect(() => {
    const menu = profileMenuRef.current;
    if (!menu || !showUserPanel) {
      return;
    }

    const typedMenu = menu as HTMLElement & {
      type?: UserMenuState;
      size?: "small" | "regular";
      hasRecentlySignedIn?: boolean;
      userInitials?: string;
      userLabel?: string;
      recentUsers?: Array<{ initials: string; label: string }>;
      signedInActions?: UserMenuAction[];
    };

    typedMenu.type = userMenuState;
    typedMenu.size = "small";
    typedMenu.hasRecentlySignedIn = false;
    typedMenu.userInitials = userInitials;
    typedMenu.userLabel = userLabel;
    typedMenu.recentUsers = [{ initials: userInitials, label: userLabel }];
    typedMenu.signedInActions = signedInActions;

    const onSignInClick = (event: Event) => {
      const detail = (event as CustomEvent<UserMenuSignInDetail>).detail;
      const username = detail?.username ?? profileUsername;
      const password = detail?.password ?? profilePassword;
      void handleProfileSignIn(username, password);
    };

    const onSignOutClick = () => {
      void handleSignOut();
    };

    const onSignedInActionClick = () => {
      // Intentionally ignored in this sprint; signed-in menu should only expose sign-out.
    };

    menu.addEventListener("sign-in-click", onSignInClick as EventListener);
    menu.addEventListener("sign-out-click", onSignOutClick as EventListener);
    menu.addEventListener("signed-in-action-click", onSignedInActionClick as EventListener);

    return () => {
      menu.removeEventListener("sign-in-click", onSignInClick as EventListener);
      menu.removeEventListener("sign-out-click", onSignOutClick as EventListener);
      menu.removeEventListener("signed-in-action-click", onSignedInActionClick as EventListener);
    };
  }, [
    handleProfileSignIn,
    handleSignOut,
    profilePassword,
    profileUsername,
    signedInActions,
    userInitials,
    userLabel,
    userMenuState,
    showUserPanel,
  ]);

  useEffect(() => {
    if (session?.user?.id) {
      setProfilePassword("");
      setProfileUsernameError("");
      setProfilePasswordError("");
      return;
    }

    setProfileUsernameError("");
    setProfilePasswordError("");
  }, [session?.user?.id]);

  const renderPublicPage = () => {
    if (currentPage === "datavision") {
      return <Datavision />;
    }

    if (currentPage === "ais") {
      return <Ais />;
    }

    if (currentPage === "components") {
      return <Components />;
    }

    if (currentPage === "fusion") {
      return <Fusion />;
    }

    return <Settings />;
  };

  const renderUploadPage = () => {
    if (!session) {
      return (
        <AuthGate
          initialMode={authGateMode}
          appError={undefined}
          onAuthenticated={handleAuthenticated}
        />
      );
    }

    if (isSessionPending) {
      return (
        <div className="app-auth-feedback">
          <ObcElevatedCard size={ObcElevatedCardSize.MultiLine}>
            <div slot="label">Checking session</div>
            <div slot="description">Loading authentication state for Upload...</div>
          </ObcElevatedCard>
        </div>
      );
    }

    if (authBridgeStatus === "error") {
      return (
        <div className="app-auth-feedback">
          <ObcElevatedCard size={ObcElevatedCardSize.MultiLine}>
            <div slot="label">Authentication error</div>
            <div slot="description">{authBridgeError || "Unable to initialize upload access."}</div>
          </ObcElevatedCard>
          <div className="app-auth-feedback__actions">
            <ObcButton variant={ButtonVariant.raised} onClick={retryAuthBridge}>
              Retry
            </ObcButton>
            <ObcButton
              variant={ButtonVariant.flat}
              disabled={isSigningOut}
              onClick={() => void handleSignOut()}
            >
              {isSigningOut ? "Signing out..." : "Sign out"}
            </ObcButton>
          </div>
        </div>
      );
    }

    if (authBridgeStatus === "loading" || authBridgeStatus === "idle" || !backendUser) {
      return (
        <div className="app-auth-feedback">
          <ObcElevatedCard size={ObcElevatedCardSize.MultiLine}>
            <div slot="label">Authenticating upload access</div>
            <div slot="description">Establishing API session...</div>
          </ObcElevatedCard>
        </div>
      );
    }

    if (!backendUser.is_admin) {
      return <AccessDenied />;
    }

    return <Upload currentUser={backendUser} />;
  };

  return (
    <>
      <header>
        <ObcTopBar
          appTitle="OpenAR"
          pageName={pageLabels[currentPage]}
          showDimmingButton
          showAppsButton
          showUserButton
          menuButtonActivated={showNavigationMenu}
          userButtonActivated={showUserPanel}
          onMenuButtonClicked={() => setShowNavigationMenu((previous) => !previous)}
          onDimmingButtonClicked={() => setShowBrillianceMenu((previous) => !previous)}
          onUserButtonClicked={() => {
            setShowNavigationMenu(false);
            setShowUserPanel((previous) => !previous);
          }}
        >
          <ObcClock
            date={new Date().toISOString()}
            timeZoneOffsetHours={new Date().getTimezoneOffset() / -60}
            showTimezone
            blinkOnlyBreakpointPx={600}
          />
        </ObcTopBar>
      </header>

      {showUserPanel && (
        <div className="user-panel">
          <obc-user-menu
            ref={profileMenuRef}
            type={userMenuState}
            size="small"
            hasRecentlySignedIn={false}
            username={profileUsername}
            password={profilePassword}
            usernameError={profileUsernameError}
            passwordError={profilePasswordError}
            userInitials={userInitials}
            userLabel={userLabel}
          />
        </div>
      )}

      {showNavigationMenu && (
        <ObcNavigationMenu className="navigation-menu">
          <div slot="main">
            <ObcNavigationItem
              label="Fusion"
              checked={currentPage === "fusion"}
              onClick={() => handleNavigationItemClick("fusion")}
            />
            <ObcNavigationItem
              label="Datavision"
              checked={currentPage === "datavision"}
              onClick={() => handleNavigationItemClick("datavision")}
            />
            <ObcNavigationItem
              label="AIS"
              checked={currentPage === "ais"}
              onClick={() => handleNavigationItemClick("ais")}
            />
            <ObcNavigationItem
              label="Components"
              checked={currentPage === "components"}
              onClick={() => handleNavigationItemClick("components")}
            />
            <ObcNavigationItem
              label="Settings"
              checked={currentPage === "settings"}
              onClick={() => handleNavigationItemClick("settings")}
            />
            <ObcNavigationItem
              label="Upload"
              checked={currentPage === "upload"}
              onClick={() => handleNavigationItemClick("upload")}
            />
          </div>
        </ObcNavigationMenu>
      )}

      <main
        className={[
          "main",
          showNavigationMenu ? "main--with-sidebar" : "",
          currentPage === "components" ? "main--no-padding" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {showBrillianceMenu && (
          <ObcBrillianceMenu
            onPaletteChanged={handleBrillianceChange}
            show-auto-brightness
            className="brilliance"
          />
        )}

        {currentPage === "upload" ? renderUploadPage() : renderPublicPage()}
      </main>
    </>
  );
}

export default App;
