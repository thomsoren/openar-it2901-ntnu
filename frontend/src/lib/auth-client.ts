import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

const fallbackBaseURL = "http://localhost:3001";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BETTER_AUTH_URL || fallbackBaseURL,
  basePath: import.meta.env.VITE_BETTER_AUTH_BASE_PATH || "/api/auth",
  plugins: [usernameClient()],
  fetchOptions: {
    credentials: "include",
  },
});
