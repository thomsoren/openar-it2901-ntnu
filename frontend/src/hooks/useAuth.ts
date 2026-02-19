import { useCallback, useEffect, useMemo, useState } from "react";
import { authClient } from "../lib/auth-client";
import {
  apiFetch,
  apiFetchPublic,
  clearApiAccessToken,
  setApiAccessToken,
} from "../lib/api-client";
import type { BackendUser } from "../pages/Upload";

type AuthBridgeStatus = "idle" | "loading" | "ready" | "error";

export type UserMenuState = "sign-in" | "loading-sign-in" | "signed-in";
export type UserMenuSignInDetail = {
  username?: string;
  password?: string;
};
export type UserMenuAction = {
  id: string;
  label: string;
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

export function useAuth(currentPage: string) {
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

  const {
    data: session,
    isPending: isSessionPending,
    refetch: refetchSession,
  } = authClient.useSession();

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
    if (session?.user?.id) {
      setProfilePassword("");
      setProfileUsernameError("");
      setProfilePasswordError("");
      return;
    }

    setProfileUsernameError("");
    setProfilePasswordError("");
  }, [session?.user?.id]);

  return {
    session,
    isSessionPending,
    backendUser,
    authBridgeStatus,
    authBridgeError,
    isSigningOut,
    isProfileSigningIn,
    profileUsername,
    profilePassword,
    profileUsernameError,
    profilePasswordError,
    userMenuState,
    userLabel,
    userInitials,
    signedInActions,
    handleAuthenticated,
    retryAuthBridge,
    handleSignOut,
    handleProfileSignIn,
  };
}
