import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: true,
      passWithNoTests: true,
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      exclude: ["node_modules", "dist"],
      css: true,
      coverage: {
        provider: "v8",
        reporter: ["text", "html"],
      },
    },
  })
);
