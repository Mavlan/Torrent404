import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export const desktopTestInclude = ["src/**/*.test.{ts,tsx}"] as const;

export default defineConfig({
  plugins: [react()],
  test: {
    // Sidecar integration tests use Node's native test runner. Keep Vitest
    // scoped to the Desktop TypeScript suites so the two runners do not
    // attempt to collect each other's files during the workspace gate.
    include: [...desktopTestInclude],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
});
