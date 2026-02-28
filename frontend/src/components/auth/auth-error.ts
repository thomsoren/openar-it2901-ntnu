/** Shape of the error object returned by Better Auth client methods. */
type BetterAuthError = { message?: string; status?: number };

/**
 * Map a Better Auth / network error to a user-friendly message.
 *
 * Prefers HTTP status codes for reliability; falls back to message keywords
 * only when the status is unavailable (e.g. network errors wrapped in Error).
 */
export const mapAuthErrorMessage = (error: unknown, fallback: string) => {
  const authErr = error as BetterAuthError | undefined;
  const status = authErr?.status;
  const message =
    (authErr?.message ?? (error instanceof Error ? error.message : undefined)) || fallback;

  if (status === 401) return "Invalid email or password";
  if (status === 422) return "Account already exists. Try signing in instead.";
  if (status === 400) return message;

  const lower = message.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Authentication service unavailable. Please try again.";
  }

  return message;
};
