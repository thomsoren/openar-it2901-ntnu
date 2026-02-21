/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_ROBOFLOW_KEY?: string;
  readonly VITE_BETTER_AUTH_URL?: string;
  readonly VITE_BETTER_AUTH_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
