import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "proxy.test.ts", "sentry.config.test.ts", "sentry.payload.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        // Pure wiring around the Supabase SDK, and browser-only helpers.
        "lib/supabase/**",
        "lib/client/**",
        "lib/db/types.ts",
      ],
      thresholds: {
        // Measured 2 Nov 2026: lines 90.7, statements 88.2, functions 90.4,
        // branches 81.1. The floors sit about two points under, so a change
        // that drops tested code fails; raise them when the numbers rise.
        lines: 88,
        statements: 86,
        functions: 88,
        branches: 79,
        "lib/auth/**": { lines: 100 },
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
