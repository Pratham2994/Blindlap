import { defineConfig } from "vite";

// Relative base so the build can be dropped into any static host or sub-path.
export default defineConfig({
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
});
