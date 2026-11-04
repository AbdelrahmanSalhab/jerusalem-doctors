import { describe, expect, it } from "vitest";
import { cleanEmail } from "./email";

describe("cleanEmail", () => {
  it("leaves a plain address alone", () => {
    expect(cleanEmail("doctor.name.16@example.com")).toBe("doctor.name.16@example.com");
  });
  it("strips spaces, no-break spaces and invisible direction or zero-width marks", () => {
    expect(cleanEmail(" a‏b@x.com‎ ﻿ ")).toBe("ab@x.com");
  });
});
