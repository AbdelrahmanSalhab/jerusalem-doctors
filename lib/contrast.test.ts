// Small text in the light theme (the page background #f6f7f4, the text
// #1b201d at some opacity) needs 4.5:1 (WCAG AA). 60% gives 4.28:1, which axe
// flagged on /dashboard whenever a row had a workplace line; 65% is the lowest
// that passes (5.0:1). The page sweep (e2e/ui/pages.spec.ts) only sees a class
// when the seeded data shows it, so this checks the source for all of them.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIN_TEXT_OPACITY = 65;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : sources(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("text opacity", () => {
  it("never drops below the 4.5:1 that small text needs on the light background", () => {
    const low: string[] = [];
    for (const file of [...sources("app"), ...sources("components")]) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const m of line.matchAll(/(?<![\w-])text-foreground\/(\d+)(?!\d)/g)) {
            if (Number(m[1]) < MIN_TEXT_OPACITY) low.push(`${file}:${i + 1} text-foreground/${m[1]}`);
          }
        });
    }
    expect(low).toEqual([]);
  });
});
