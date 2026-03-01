import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  // Set target to es2022 to avoid Vite's default downleveling which breaks maplibre-gl's use of class fields.
  optimizeDeps: {
    esbuildOptions: {
      target: "es2022",
    },
  },
  build: {
    target: "es2022",
  },
  server: {
    host: true, // Listen on all addresses (0.0.0.0) for dev containers
    port: 5173,
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
