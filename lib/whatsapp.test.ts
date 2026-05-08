import { describe, expect, it } from "vitest";
import { DEFAULT_WHATSAPP_PREFILLED, buildWhatsAppLink } from "./whatsapp";

describe("buildWhatsAppLink", () => {
  it("strips the leading + and uses wa.me/<digits>", () => {
    const url = buildWhatsAppLink("+972501234567", "");
    expect(url).toBe("https://wa.me/972501234567");
  });

  it("works with already-stripped E.164", () => {
    const url = buildWhatsAppLink("972501234567", "");
    expect(url).toBe("https://wa.me/972501234567");
  });

  it("appends URL-encoded prefilled text", () => {
    const url = buildWhatsAppLink("+972501234567", "hello & goodbye");
    expect(url).toBe(
      "https://wa.me/972501234567?text=hello%20%26%20goodbye",
    );
  });

  it("uses the Arabic default greeting when no text argument is passed", () => {
    const url = buildWhatsAppLink("+972501234567");
    expect(url).toContain("https://wa.me/972501234567?text=");
    expect(decodeURIComponent(url.split("text=")[1])).toBe(
      DEFAULT_WHATSAPP_PREFILLED,
    );
  });

  it("URL-encodes Arabic correctly", () => {
    const url = buildWhatsAppLink("+972501234567", "السلام عليكم");
    const decoded = decodeURIComponent(url.split("text=")[1]);
    expect(decoded).toBe("السلام عليكم");
    // ensure each Arabic byte was percent-encoded
    expect(url.split("text=")[1]).toMatch(/^(%[0-9A-F]{2})+$/);
  });

  it("throws on empty phone", () => {
    expect(() => buildWhatsAppLink("", "")).toThrow();
    expect(() => buildWhatsAppLink("+", "")).toThrow();
  });
});
