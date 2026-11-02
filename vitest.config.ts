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
        // Measured 2 Nov 2026: statements 98.4, branches 95.3, functions
        // 99.8, lines 98.6. The floors are 95 for all four, so a change that
        // drops tested code fails; lib/auth is held to 100 lines below.
        lines: 95,
        statements: 95,
        functions: 95,
        branches: 95,
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
