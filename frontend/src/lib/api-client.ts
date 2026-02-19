const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

let accessToken: string | null = null;

const resolveUrl = (input: string): string => {
  if (
    input.startsWith("http://") ||
    input.startsWith("https://") ||
    input.startsWith("ws://") ||
    input.startsWith("wss://")
  ) {
    return input;
  }

  return `${API_BASE_URL}${input.startsWith("/") ? input : `/${input}`}`;
};

export const setApiAccessToken = (token: string | null) => {
  accessToken = token;
};

export const clearApiAccessToken = () => {
  accessToken = null;
};

export const getApiAccessToken = () => accessToken;

export const withAccessToken = (url: string): string => {
  if (!accessToken) {
    return url;
  }

  const resolved = new URL(resolveUrl(url));
  resolved.searchParams.set("access_token", accessToken);
  return resolved.toString();
};

const toHeaders = (headers?: HeadersInit): Headers => {
  if (headers instanceof Headers) {
    return new Headers(headers);
  }

  return new Headers(headers || {});
};

export const apiFetchPublic = (input: string, init?: RequestInit) => {
  return fetch(resolveUrl(input), {
    ...init,
    credentials: "include",
  });
};

export const apiFetch = (input: string, init?: RequestInit) => {
  const headers = toHeaders(init?.headers);

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  return fetch(resolveUrl(input), {
    ...init,
    credentials: "include",
    headers,
  });
};

export const getApiBaseUrl = () => API_BASE_URL;
