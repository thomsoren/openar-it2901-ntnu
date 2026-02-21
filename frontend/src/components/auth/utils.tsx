/** Shape of the error object returned by Better Auth client methods. */
type BetterAuthError = { message?: string; status?: number };

/**
 * Map a Better Auth / network error to a user-friendly message.
 *
 * Prefers HTTP status codes for reliability; falls back to message keywords
 * only when the status is unavailable (e.g. network errors wrapped in Error).
 */
export const mapAuthErrorMessage = (error: unknown, fallback: string) => {
  // Better Auth error objects carry { message, status }.
  const authErr = error as BetterAuthError | undefined;
  const status = authErr?.status;
  const message =
    (authErr?.message ?? (error instanceof Error ? error.message : undefined)) || fallback;

  // Status-based matching (preferred — resilient to wording changes)
  if (status === 401) return "Invalid email or password";
  if (status === 422) return "Account already exists. Try signing in instead.";
  if (status === 400) return message; // validation error — Better Auth message is descriptive

  // Fallback: keyword matching for errors without a status (e.g. network)
  const lower = message.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Authentication service unavailable. Please try again.";
  }

  return message;
};

export const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" style={{ display: "block" }}>
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);
