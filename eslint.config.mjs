import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // A missing await in a Playwright test is the classic flaky test: the step
  // races the next one. Typed linting only where it pays for itself.
  {
    files: ["e2e/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Generated from the database (npm run db:types).
    "lib/db/database.types.ts",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local git worktrees carry their own builds.
    ".worktrees/**",
    ".claude/worktrees/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
