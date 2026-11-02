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
  // Who is in the directory is the `listed_doctors` view (#158): the five
  // conditions are written once, in the database. Reading the doctors table
  // directly in code that serves doctors would skip them, so only the code
  // below, which needs the row itself (the admin panel, sign-in and sign-up,
  // the cron jobs, the session, a few helpers), may. A new file that lists
  // doctors reads the view; one that really needs the table is added here,
  // which is the review point.
  {
    files: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "proxy.ts"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "app/(admin)/**",
      "app/api/admin/**",
      "app/api/cron/**",
      "app/api/login/**",
      "app/api/signup/**",
      "app/api/profile/delete-request/**",
      "components/SiteHeader.tsx",
      "lib/admin/**",
      "lib/auth/**",
      "lib/institutions.ts",
      "lib/otp/**",
      "lib/profile/photoUpload.ts",
      "lib/reports.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='from'][arguments.0.value='doctors']",
          message:
            'Do not read the doctors table here: use the listed_doctors view, which holds who is in the directory (#158). If this code needs the row itself, add the file to the allowlist in eslint.config.mjs.',
        },
      ],
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
