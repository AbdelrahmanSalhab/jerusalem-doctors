import { describe, expect, it } from "vitest";
import { buildAuthTemplatePayload } from "./whatsapp_meta";

describe("buildAuthTemplatePayload", () => {
  const payload = buildAuthTemplatePayload("+972501234567", "123456", "otp_login_ar");

  it("strips the leading + from the recipient", () => {
    expect(payload.to).toBe("972501234567");
  });

  it("leaves an already-plainless number alone", () => {
    expect(buildAuthTemplatePayload("972501234567", "1", "t").to).toBe("972501234567");
  });

  it("targets the named template in Arabic by default", () => {
    expect(payload.template.name).toBe("otp_login_ar");
    expect(payload.template.language.code).toBe("ar");
  });

  it("honours a language override", () => {
    const p = buildAuthTemplatePayload("+972501234567", "1", "t", "en_US");
    expect(p.template.language.code).toBe("en_US");
  });

  it("puts the code in BOTH the body and the copy-code button", () => {
    const [body, button] = payload.template.components;
    expect(body.type).toBe("body");
    expect(body.parameters[0]?.text).toBe("123456");
    expect(button.type).toBe("button");
    expect(button.sub_type).toBe("url");
    expect(button.index).toBe("0");
    expect(button.parameters[0]?.text).toBe("123456");
  });

  it("preserves leading zeros in the code", () => {
    const p = buildAuthTemplatePayload("+972501234567", "000123", "t");
    expect(p.template.components[0]?.parameters[0]?.text).toBe("000123");
  });

  it("declares the whatsapp product and individual recipient", () => {
    expect(payload.messaging_product).toBe("whatsapp");
    expect(payload.recipient_type).toBe("individual");
    expect(payload.type).toBe("template");
  });
});
