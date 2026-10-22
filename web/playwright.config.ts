import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 150_000,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1440, height: 900 },
    // Headless Chromium needs a GL backend for the Three.js scene.
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] },
  },
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: true,
  },
});
