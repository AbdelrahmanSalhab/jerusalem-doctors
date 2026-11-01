import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function render(message?: string) {
  const { SupportContact } = await import("@/components/SupportContact");
  return renderToStaticMarkup(SupportContact({ message }));
}

describe("SupportContact", () => {
  it("renders nothing until the number is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER", "");
    expect(await render()).toBe("");
  });

  it("opens an empty chat without a message", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER", "972501234567");
    expect(await render()).toContain('href="https://wa.me/972501234567"');
  });

  it("opens the chat with the message, encoded", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER", "972501234567");
    expect(await render("لم يصلني الرمز")).toContain(`https://wa.me/972501234567?text=${encodeURIComponent("لم يصلني الرمز")}`);
  });
});
