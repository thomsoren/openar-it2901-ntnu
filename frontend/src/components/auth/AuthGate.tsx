import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ObcAlertFrame } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/alert-frame/alert-frame";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcInput } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/input/input";
import { ObcProgressButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/progress-button/progress-button";
import "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/user-menu/user-menu";
import {
  ObcAlertFrameStatus,
  ObcAlertFrameType,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/alert-frame/alert-frame";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { HTMLInputTypeAttribute } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/input/input";
import {
  ButtonStyle,
  ProgressButtonType,
  ProgressMode,
} from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/progress-button/progress-button";
import { authClient } from "../../lib/auth-client";
import "./AuthGate.css";

type AuthMode = "login" | "signup";

type FormErrors = {
  username?: string;
  password?: string;
  confirmPassword?: string;
};

type AuthGateProps = {
  initialMode?: AuthMode;
  appError?: string;
  onAuthenticated: () => Promise<void> | void;
};

type UserMenuSignInDetail = {
  username?: string;
  password?: string;
};

const readInputValue = (event: Event): string => {
  const target = (event.currentTarget || event.target) as { value?: string } | null;
  return target?.value ?? "";
};

const normalizeUsername = (value: string) => value.trim().toLowerCase();

const syntheticEmailFromUsername = (username: string) => `${username}@openar.local`;

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

const mapAuthErrorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : fallback;
  const lower = message.toLowerCase();

  if (
    lower.includes("username") &&
    (lower.includes("exists") || lower.includes("taken") || lower.includes("already"))
  ) {
    return "Username already taken";
  }

  if (lower.includes("invalid username or password") || lower.includes("invalid credentials")) {
    return "Invalid username or password";
  }

  if (lower.includes("unprocessable_entity")) {
    return "Invalid input. Check username and password format.";
  }

  return message;
};

export default function AuthGate({
  initialMode = "login",
  appError,
  onAuthenticated,
}: AuthGateProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);

  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [signupUsername, setSignupUsername] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const userMenuRef = useRef<HTMLElement | null>(null);

  const serviceError = useMemo(() => {
    if (!appError) {
      return null;
    }
    const lower = appError.toLowerCase();
    if (lower.includes("networkerror") || lower.includes("failed to fetch")) {
      return "Authentication service unavailable. Start auth-service and try again.";
    }
    return appError;
  }, [appError]);

  const loginDisplayLabel = useMemo(
    () => normalizeUsername(loginUsername) || "User",
    [loginUsername]
  );
  const loginDisplayInitials = useMemo(() => getInitials(loginDisplayLabel), [loginDisplayLabel]);

  useEffect(() => {
    setMode(initialMode);
    setFormError(null);
    setFormErrors({});
  }, [initialMode]);

  const validateLogin = (usernameValue: string, passwordValue: string): boolean => {
    const nextErrors: FormErrors = {};

    if (!normalizeUsername(usernameValue)) {
      nextErrors.username = "Username is required";
    }

    if (!passwordValue) {
      nextErrors.password = "Password is required";
    }

    setFormErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const validateSignup = (): boolean => {
    const nextErrors: FormErrors = {};

    const normalized = normalizeUsername(signupUsername);
    if (!normalized) {
      nextErrors.username = "Username is required";
    } else if (!/^[a-z0-9_.]+$/.test(normalized)) {
      nextErrors.username = "Use lowercase letters, numbers, underscore or dot";
    }

    if (!signupPassword) {
      nextErrors.password = "Password is required";
    } else if (signupPassword.length < 8) {
      nextErrors.password = "Password must be at least 8 characters";
    }

    if (!signupConfirmPassword) {
      nextErrors.confirmPassword = "Confirm your password";
    } else if (signupPassword !== signupConfirmPassword) {
      nextErrors.confirmPassword = "Passwords do not match";
    }

    setFormErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const resetTransientState = () => {
    setFormError(null);
    setFormErrors({});
  };

  const handleModeToggle = (nextMode: AuthMode) => {
    setMode(nextMode);
    resetTransientState();
  };

  const submitLogin = useCallback(
    async (rawUsername: string, rawPassword: string) => {
      resetTransientState();

      if (!validateLogin(rawUsername, rawPassword)) {
        return;
      }

      const normalizedUsername = normalizeUsername(rawUsername);
      setIsSubmitting(true);

      try {
        const signInResponse = await authClient.signIn.username({
          username: normalizedUsername,
          password: rawPassword,
        });

        if (signInResponse.error) {
          throw new Error(signInResponse.error.message || "Invalid username or password");
        }

        setLoginUsername(normalizedUsername);
        await onAuthenticated();
      } catch (error) {
        setFormError(mapAuthErrorMessage(error, "Authentication failed"));
      } finally {
        setIsSubmitting(false);
      }
    },
    [onAuthenticated]
  );

  const submitSignup = async () => {
    resetTransientState();

    if (!validateSignup()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const normalizedUsername = normalizeUsername(signupUsername);
      const signUpResponse = await authClient.signUp.email({
        name: normalizedUsername,
        username: normalizedUsername,
        email: syntheticEmailFromUsername(normalizedUsername),
        password: signupPassword,
      });

      if (signUpResponse.error) {
        throw new Error(signUpResponse.error.message || "Sign up failed");
      }

      setLoginUsername(normalizedUsername);
      setLoginPassword(signupPassword);
      await onAuthenticated();
    } catch (error) {
      setFormError(mapAuthErrorMessage(error, "Authentication failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    const element = userMenuRef.current;
    if (!element) {
      return;
    }

    const onSignInClick = (event: Event) => {
      const detail = (event as CustomEvent<UserMenuSignInDetail>).detail;
      const username = detail?.username ?? loginUsername;
      const password = detail?.password ?? loginPassword;
      setLoginUsername(username);
      setLoginPassword(password);
      void submitLogin(username, password);
    };

    element.addEventListener("sign-in-click", onSignInClick as EventListener);
    return () => {
      element.removeEventListener("sign-in-click", onSignInClick as EventListener);
    };
  }, [loginPassword, loginUsername, submitLogin]);

  return (
    <div className="auth-gate">
      <div className="auth-gate__card">
        {mode === "login" ? (
          <>
            {isSubmitting ? (
              <obc-user-menu
                type="loading-sign-in"
                size="regular"
                hasRecentlySignedIn={false}
                userInitials={loginDisplayInitials}
                userLabel={loginDisplayLabel}
              />
            ) : (
              <obc-user-menu
                ref={userMenuRef}
                type="sign-in"
                size="regular"
                hasRecentlySignedIn={false}
                username={loginUsername}
                password={loginPassword}
                usernameError={formErrors.username || ""}
                passwordError={formErrors.password || ""}
                userInitials={loginDisplayInitials}
                userLabel={loginDisplayLabel}
              />
            )}

            {formError && (
              <ObcAlertFrame
                type={ObcAlertFrameType.Regular}
                status={ObcAlertFrameStatus.Alarm}
                className="auth-gate__alert"
              >
                <div>{formError}</div>
              </ObcAlertFrame>
            )}

            {serviceError && <div className="auth-gate__service-error">{serviceError}</div>}

            <ObcButton
              variant={ButtonVariant.flat}
              disabled={isSubmitting}
              onClick={() => handleModeToggle("signup")}
            >
              Need an account? Sign up
            </ObcButton>
          </>
        ) : (
          <div className="auth-gate__signup">
            <div className="auth-gate__heading">Create account</div>
            <div className="auth-gate__subheading">
              Create a local account with username and password
            </div>

            <ObcInput
              type={HTMLInputTypeAttribute.Text}
              required
              value={signupUsername}
              error={Boolean(formErrors.username)}
              placeholder="Username"
              onInput={(event) => setSignupUsername(readInputValue(event as Event))}
            >
              {formErrors.username && <span slot="helper-text">{formErrors.username}</span>}
            </ObcInput>

            <ObcInput
              type={HTMLInputTypeAttribute.Password}
              required
              value={signupPassword}
              error={Boolean(formErrors.password)}
              placeholder="Password"
              onInput={(event) => setSignupPassword(readInputValue(event as Event))}
            >
              {formErrors.password && <span slot="helper-text">{formErrors.password}</span>}
            </ObcInput>

            <ObcInput
              type={HTMLInputTypeAttribute.Password}
              required
              value={signupConfirmPassword}
              error={Boolean(formErrors.confirmPassword)}
              placeholder="Confirm password"
              onInput={(event) => setSignupConfirmPassword(readInputValue(event as Event))}
            >
              {formErrors.confirmPassword && (
                <span slot="helper-text">{formErrors.confirmPassword}</span>
              )}
            </ObcInput>

            {formError && (
              <ObcAlertFrame
                type={ObcAlertFrameType.Regular}
                status={ObcAlertFrameStatus.Alarm}
                className="auth-gate__alert"
              >
                <div>{formError}</div>
              </ObcAlertFrame>
            )}

            {serviceError && <div className="auth-gate__service-error">{serviceError}</div>}

            <ObcProgressButton
              type={ProgressButtonType.Linear}
              buttonStyle={ButtonStyle.Raised}
              mode={ProgressMode.Indeterminate}
              showProgress={isSubmitting}
              disabled={isSubmitting}
              label="Create account"
              onClick={() => void submitSignup()}
            />

            <ObcButton
              variant={ButtonVariant.flat}
              disabled={isSubmitting}
              onClick={() => handleModeToggle("login")}
            >
              Already have an account? Sign in
            </ObcButton>
          </div>
        )}
      </div>
    </div>
  );
}
