import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
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
        lines: 81,
        statements: 80,
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
