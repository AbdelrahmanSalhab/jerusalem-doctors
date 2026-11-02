import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INSTALL_OFFER_ATTR } from "@/lib/install/context";
import { trackInstall } from "./track";

const sendBeacon = vi.fn();
let marked = true;

beforeEach(() => {
  marked = true;
  sendBeacon.mockReset();
  vi.stubGlobal("document", { documentElement: { hasAttribute: (a: string) => marked && a === INSTALL_OFFER_ATTR } });
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120", maxTouchPoints: 5, sendBeacon });
});
afterEach(() => vi.unstubAllGlobals());

describe("trackInstall", () => {
  it("sends one beacon for a signed-in doctor", () => {
    trackInstall("install_clicked" as never, "card");
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe("/api/usage/install");
    expect(JSON.parse(sendBeacon.mock.calls[0][1])).toMatchObject({ kind: "install_clicked", source: "card" });
  });

  it("sends nothing for a visitor", () => {
    marked = false;
    trackInstall("install_clicked" as never);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("never fails the step when the beacon throws", () => {
    sendBeacon.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => trackInstall("install_clicked" as never)).not.toThrow();
  });
});
