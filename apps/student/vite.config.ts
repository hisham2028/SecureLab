import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@securelab/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  // Monaco is large; this is a desktop app loaded from disk, so one big chunk is acceptable.
  build: { outDir: "../../dist/renderer", emptyOutDir: true, chunkSizeWarningLimit: 4096 },
  server: { port: 5174, strictPort: true },
  test: { root: ".", include: ["src/**/*.test.ts"], environment: "node" },
});
