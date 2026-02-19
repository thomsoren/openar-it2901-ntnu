import { useCallback, useEffect, useRef } from "react";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { authClient } from "../../lib/auth-client";
import type { TextInputElement } from "./types";
import {
  clearInputError,
  getInputValue,
  mapAuthErrorMessage,
  normalizeUsername,
  setInputError,
  syntheticEmailFromUsername,
  GoogleIcon,
} from "./utils";

type SignupFormProps = {
  isSubmitting: boolean;
  setIsSubmitting: (value: boolean) => void;
  onAuthenticated: () => Promise<void> | void;
};

export default function SignupForm({
  isSubmitting,
  setIsSubmitting,
  onAuthenticated,
}: SignupFormProps) {
  const emailRef = useRef<TextInputElement | null>(null);
  const passwordRef = useRef<TextInputElement | null>(null);
  const confirmRef = useRef<TextInputElement | null>(null);

  useEffect(() => {
    const el = emailRef.current;
    if (el) {
      el.label = "Email";
      el.placeholder = "your@email.com";
    }

    const pw = passwordRef.current;
    if (pw) {
      pw.label = "Password";
      pw.placeholder = "Password";
      pw.type = "password";
    }

    const cf = confirmRef.current;
    if (cf) {
      cf.label = "Confirm password";
      cf.placeholder = "Password";
      cf.type = "password";
    }
  }, []);

  useEffect(() => {
    if (emailRef.current) emailRef.current.disabled = isSubmitting;
    if (passwordRef.current) passwordRef.current.disabled = isSubmitting;
    if (confirmRef.current) confirmRef.current.disabled = isSubmitting;
  }, [isSubmitting]);

  const handleSignUp = useCallback(async () => {
    clearInputError(emailRef);
    clearInputError(passwordRef);
    clearInputError(confirmRef);

    const email = getInputValue(emailRef).trim();
    const password = getInputValue(passwordRef);
    const confirmPassword = getInputValue(confirmRef);

    let hasError = false;
    if (!email) {
      setInputError(emailRef, "Email is required");
      hasError = true;
    }
    if (!password) {
      setInputError(passwordRef, "Password is required");
      hasError = true;
    } else if (password.length < 8) {
      setInputError(passwordRef, "Password must be at least 8 characters");
      hasError = true;
    }
    if (!confirmPassword) {
      setInputError(confirmRef, "Confirm your password");
      hasError = true;
    } else if (password !== confirmPassword) {
      setInputError(confirmRef, "Passwords do not match");
      hasError = true;
    }
    if (hasError) return;

    setIsSubmitting(true);
    try {
      const normalizedUsername = normalizeUsername(email);
      const signUpResponse = await authClient.signUp.email({
        name: normalizedUsername,
        username: normalizedUsername,
        email: syntheticEmailFromUsername(normalizedUsername),
        password,
      });

      if (signUpResponse.error) {
        throw new Error(signUpResponse.error.message || "Sign up failed");
      }

      await onAuthenticated();
    } catch (error) {
      setInputError(passwordRef, mapAuthErrorMessage(error, "Sign up failed"));
    } finally {
      setIsSubmitting(false);
    }
  }, [onAuthenticated, setIsSubmitting]);

  return (
    <div className="auth-gate__form">
      <div className="auth-gate__inputs">
        <obc-text-input-field ref={emailRef} />
        <obc-text-input-field ref={passwordRef} />
        <obc-text-input-field ref={confirmRef} />
      </div>
      <div className="auth-gate__actions">
        <ObcButton
          variant={ButtonVariant.raised}
          fullWidth
          disabled={isSubmitting}
          onClick={() => void handleSignUp()}
        >
          Create account
        </ObcButton>
        <ObcButton variant={ButtonVariant.normal} fullWidth showLeadingIcon>
          <span slot="leading-icon">
            <GoogleIcon />
          </span>
          Continue with Google
        </ObcButton>
      </div>
    </div>
  );
}
