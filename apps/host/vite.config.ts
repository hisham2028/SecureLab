import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Consume shared TypeScript source directly so the dashboard needs no CJS interop.
    alias: {
      "@securelab/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:3000", rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  test: { environment: "jsdom" },
});
