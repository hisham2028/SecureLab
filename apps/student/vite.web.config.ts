import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/** The browser version of the student app: the same screens, served from /student/. */
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
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: { index: fileURLToPath(new URL("src/renderer/web.html", import.meta.url)) },
    },
  },
});
