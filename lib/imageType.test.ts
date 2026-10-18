import { describe, expect, it } from "vitest";
import { sniffImageType } from "./imageType";

const bytes = (...b: (number | string)[]) =>
  new Uint8Array(
    b.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])),
  );

describe("sniffImageType", () => {
  it("detects JPEG", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("image/jpeg");
  });

  it("detects PNG", () => {
    expect(
      sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)),
    ).toBe("image/png");
  });

  it("detects WebP", () => {
    expect(sniffImageType(bytes("RIFF", 1, 2, 3, 4, "WEBPVP8 "))).toBe("image/webp");
  });

  it("rejects a RIFF file that is not WebP", () => {
    expect(sniffImageType(bytes("RIFF", 1, 2, 3, 4, "WAVEfmt "))).toBeNull();
  });

  it("rejects text, SVG and empty input", () => {
    expect(sniffImageType(bytes("hello world"))).toBeNull();
    expect(sniffImageType(bytes("<svg xmlns='x'>"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});
