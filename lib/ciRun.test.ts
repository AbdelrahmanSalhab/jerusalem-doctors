import { describe, expect, it } from "vitest";
import { ciRunOf } from "./ciRun";

const req = (v?: string) => new Request("https://x.test", { headers: v === undefined ? {} : { "x-ci-run": v } });

describe("ciRunOf", () => {
  it("reads a GitHub Actions run URL", () => {
    const run = "https://github.com/AbdelrahmanSalhab/jerusalem-doctors/actions/runs/123";
    expect(ciRunOf(req(run))).toBe(run);
    expect(ciRunOf(req(`${run}/attempts/2`))).toBe(`${run}/attempts/2`);
  });

  it("ignores a missing header and anything not shaped like a run", () => {
    expect(ciRunOf(req())).toBeNull();
    expect(ciRunOf(req("yes"))).toBeNull();
    expect(ciRunOf(req("https://evil.test/actions/runs/1"))).toBeNull();
    expect(ciRunOf(req("https://github.com/a/b/actions/runs/1<script>"))).toBeNull();
  });
});
