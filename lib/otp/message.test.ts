import { describe, expect, it } from "vitest";
import { MAX_SEGMENT_CHARS, buildOtpMessage } from "./message";

describe("buildOtpMessage", () => {
  it("includes the code", () => {
    expect(buildOtpMessage("123456")).toContain("123456");
  });

  it("starts with the code, so phones offer it", () => {
    expect(buildOtpMessage("482913").startsWith("482913 ")).toBe(true);
  });

  it("preserves a leading zero in the code", () => {
    expect(buildOtpMessage("012345")).toContain("012345");
  });

  // Guards the billing assumption documented in message.ts: Arabic is UCS-2,
  // so anything over 70 characters costs two segments on every single login.
  it("fits in one UCS-2 segment", () => {
    expect(buildOtpMessage("123456").length).toBeLessThanOrEqual(
      MAX_SEGMENT_CHARS,
    );
  });
});
