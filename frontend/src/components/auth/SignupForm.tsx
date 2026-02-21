import { useCallback, useState } from "react";
import { ObcButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/button/button";
import { ObcTextInputField } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/text-input-field/text-input-field";
import { ButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/button/button";
import { HTMLInputTypeAttribute } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/text-input-field/text-input-field";
import { authClient } from "../../lib/auth-client";
import { mapAuthErrorMessage, GoogleIcon } from "./utils";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");

  const handleSignUp = useCallback(async () => {
    setEmailError("");
    setPasswordError("");
    setConfirmError("");

    const trimmedEmail = email.trim();

    let hasError = false;
    if (!trimmedEmail) {
      setEmailError("Email is required");
      hasError = true;
    }
    if (!password) {
      setPasswordError("Password is required");
      hasError = true;
    } else if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      hasError = true;
    }
    if (!confirmPassword) {
      setConfirmError("Confirm your password");
      hasError = true;
    } else if (password !== confirmPassword) {
      setConfirmError("Passwords do not match");
      hasError = true;
    }
    if (hasError) return;

    setIsSubmitting(true);
    try {
      const normalizedEmail = trimmedEmail.toLowerCase();
      const username = normalizedEmail.includes("@")
        ? normalizedEmail.split("@")[0]
        : normalizedEmail;
      const signUpResponse = await authClient.signUp.email({
        name: username,
        username,
        email: normalizedEmail,
        password,
      });

      if (signUpResponse.error) {
        setPasswordError(mapAuthErrorMessage(signUpResponse.error, "Sign up failed"));
        return;
      }

      await onAuthenticated();
    } catch (error) {
      setPasswordError(mapAuthErrorMessage(error, "Sign up failed"));
    } finally {
      setIsSubmitting(false);
    }
  }, [email, password, confirmPassword, onAuthenticated, setIsSubmitting]);

  return (
    <div className="auth-gate__form">
      <div className="auth-gate__inputs">
        <ObcTextInputField
          label="Email"
          placeholder="your@email.com"
          value={email}
          disabled={isSubmitting}
          error={Boolean(emailError)}
          errorText={emailError}
          onInput={(e) => {
            const target = e.target as HTMLInputElement;
            setEmail(target.value);
          }}
        />
        <ObcTextInputField
          label="Password"
          placeholder="Password"
          type={HTMLInputTypeAttribute.Password}
          value={password}
          disabled={isSubmitting}
          error={Boolean(passwordError)}
          errorText={passwordError}
          onInput={(e) => {
            const target = e.target as HTMLInputElement;
            setPassword(target.value);
          }}
        />
        <ObcTextInputField
          label="Confirm password"
          placeholder="Password"
          type={HTMLInputTypeAttribute.Password}
          value={confirmPassword}
          disabled={isSubmitting}
          error={Boolean(confirmError)}
          errorText={confirmError}
          onInput={(e) => {
            const target = e.target as HTMLInputElement;
            setConfirmPassword(target.value);
          }}
        />
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
