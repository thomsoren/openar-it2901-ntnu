import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

const envBaseURL = import.meta.env.VITE_BETTER_AUTH_URL?.trim();
const resolvedBaseURL = envBaseURL || (import.meta.env.DEV ? "http://localhost:3001" : "");

if (!resolvedBaseURL) {
  throw new Error("Missing VITE_BETTER_AUTH_URL in production environment");
}

export const authClient = createAuthClient({
  baseURL: resolvedBaseURL,
  basePath: import.meta.env.VITE_BETTER_AUTH_BASE_PATH || "/api/auth",
  plugins: [usernameClient()],
  fetchOptions: {
    credentials: "include",
  },
});
