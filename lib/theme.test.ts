// The boot script is a string run before paint; run it against a stand-in page.

import { describe, expect, it } from "vitest";
import { THEME_BOOT_SCRIPT, THEME_KEY, THEMES } from "./theme";

function boot(saved: string | null, dark: boolean, broken = false) {
  const attrs: Record<string, string> = {};
  let onChange = () => {};
  const media = { matches: dark, addEventListener: (_: string, f: () => void) => (onChange = f) };
  const storage = { getItem: () => (broken ? (() => { throw new Error("blocked"); })() : saved) };
  new Function("localStorage", "window", "document", THEME_BOOT_SCRIPT)(
    storage,
    { matchMedia: () => media },
    { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
  );
  return { attrs, switchTo: (next: string | null, nowDark: boolean) => { saved = next; media.matches = nowDark; onChange(); return attrs["data-theme"]; } };
}

describe("theme boot script", () => {
  it("follows the device on auto, and an explicit choice over it", () => {
    expect(boot(null, true).attrs["data-theme"]).toBe("dark");
    expect(boot(null, false).attrs["data-theme"]).toBe("light");
    expect(boot("light", true).attrs["data-theme"]).toBe("light");
    expect(boot("dark", false).attrs["data-theme"]).toBe("dark");
  });

  it("re-applies when the device changes", () => {
    expect(boot(null, false).switchTo(null, true)).toBe("dark");
  });

  it("never throws when storage is blocked", () => {
    expect(() => boot(null, false, true)).not.toThrow();
  });

  it("names its key and choices", () => {
    expect(THEME_KEY).toBe("theme");
    expect(THEMES).toEqual(["auto", "light", "dark"]);
  });
});
