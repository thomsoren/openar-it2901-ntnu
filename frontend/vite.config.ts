import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  optimizeDeps: {
    // Avoid brittle prebundle cache issues with large web component packages.
    exclude: [
      "@ocean-industries-concept-lab/openbridge-webcomponents",
      "@ocean-industries-concept-lab/openbridge-webcomponents-react",
    ],
  },
  server: {
    host: true, // Listen on all addresses (0.0.0.0) for dev containers
    port: 5273,
    strictPort: false,
  },
  preview: {
    host: true, // Listen on all addresses (0.0.0.0) for dev containers
    port: 4173,
    strictPort: false,
    allowedHosts: ["demo.bridgable.ai", ".bridgable.ai"], // Allow production domain
  },
  plugins: [react()],
});
