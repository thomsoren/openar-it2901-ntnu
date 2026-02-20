import { useCallback, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { authClient } from "../lib/auth-client";
import { apiFetchPublic, clearApiAccessToken, setApiAccessToken } from "../lib/api-client";
import { readApiError } from "../utils/api-helpers";
import {
  ObcUserMenuType,
  type ObcUserMenuSignedInAction,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/user-menu/user-menu.js";
import { AuthContext } from "./auth-context";

// Refresh the backend JWT this many seconds before it expires.
const REFRESH_BUFFER_SEC = 60;

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authBridgeStatus, setAuthBridgeStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  );
  const [authBridgeError, setAuthBridgeError] = useState("");
  const [authBootstrapNonce, setAuthBootstrapNonce] = useState(0);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    data: session,
    isPending: isSessionPending,
    refetch: refetchSession,
  } = authClient.useSession();

  const sessionUsername = (session?.user as { username?: string } | undefined)?.username;
  const signedInActions = useMemo<ObcUserMenuSignedInAction[]>(
    () => [{ id: "noop", label: "" }],
    []
  );
  const userLabel = sessionUsername || session?.user?.name || session?.user?.email || "User";
  const userInitials = useMemo(() => getInitials(userLabel), [userLabel]);
  const userMenuState =
    isSigningOut || isSessionPending
      ? ObcUserMenuType.loadingSignIn
      : session
        ? ObcUserMenuType.signedIn
        : ObcUserMenuType.signIn;

  useEffect(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    if (!session?.user?.id) {
      clearApiAccessToken();
      setAuthBridgeStatus("idle");
      setAuthBridgeError("");
      return;
    }

    let cancelled = false;

    const exchangeToken = async (): Promise<number | null> => {
      const exchangeResponse = await apiFetchPublic("/auth/token/exchange", {
        method: "POST",
      });

      if (!exchangeResponse.ok) {
        throw new Error(await readApiError(exchangeResponse, "Failed to exchange token"));
      }

      const exchangePayload = (await exchangeResponse.json()) as {
        access_token: string;
        expires_in: number;
      };

      setApiAccessToken(exchangePayload.access_token);
      return exchangePayload.expires_in;
    };

    const scheduleRefresh = (expiresIn: number) => {
      const refreshInSec = Math.max(expiresIn - REFRESH_BUFFER_SEC, 10);
      refreshTimerRef.current = setTimeout(() => {
        void silentRefresh();
      }, refreshInSec * 1000);
    };

    const silentRefresh = async () => {
      try {
        const expiresIn = await exchangeToken();
        if (!cancelled && expiresIn) {
          scheduleRefresh(expiresIn);
        }
      } catch {
        if (!cancelled) {
          clearApiAccessToken();
          setAuthBridgeStatus("error");
          setAuthBridgeError("Session expired. Please sign in again.");
        }
      }
    };

    const bootstrapBackendAuth = async () => {
      setAuthBridgeStatus("loading");
      setAuthBridgeError("");

      try {
        const expiresIn = await exchangeToken();

        if (cancelled) {
          return;
        }

        setAuthBridgeStatus("ready");

        if (expiresIn) {
          scheduleRefresh(expiresIn);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        clearApiAccessToken();
        setAuthBridgeStatus("error");
        setAuthBridgeError(error instanceof Error ? error.message : "Authentication bridge failed");
      }
    };

    void bootstrapBackendAuth();

    return () => {
      cancelled = true;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [session?.user?.id, authBootstrapNonce]);

  const handleAuthenticated = useCallback(async () => {
    await refetchSession();
    setAuthBootstrapNonce((previous) => previous + 1);
  }, [refetchSession]);

  const retryAuthBridge = useCallback(() => {
    setAuthBootstrapNonce((previous) => previous + 1);
  }, []);

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
      await refetchSession();
      setAuthBootstrapNonce((previous) => previous + 1);
      setIsSigningOut(false);
    }
  }, [refetchSession]);

  const value = useMemo(
    () => ({
      session,
      isSessionPending,
      authBridgeStatus,
      authBridgeError,
      isSigningOut,
      userMenuState,
      userLabel,
      userInitials,
      signedInActions,
      handleAuthenticated,
      retryAuthBridge,
      handleSignOut,
    }),
    [
      session,
      isSessionPending,
      authBridgeStatus,
      authBridgeError,
      isSigningOut,
      userMenuState,
      userLabel,
      userInitials,
      signedInActions,
      handleAuthenticated,
      retryAuthBridge,
      handleSignOut,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
