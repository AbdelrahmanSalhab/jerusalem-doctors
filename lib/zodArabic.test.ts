import { describe, expect, it } from "vitest";
import { z } from "zod";
import "./zodArabic";

const messages = (schema: z.ZodType, value: unknown) =>
  schema.safeParse(value).error?.issues.map((i) => i.message);

describe("zod Arabic messages", () => {
  it("replaces zod's English defaults", () => {
    expect(messages(z.string().min(2), "x")).toEqual(["قصير جدًا: 2 أحرف على الأقل."]);
    expect(messages(z.string().max(3), "abcd")).toEqual(["طويل جدًا: 3 حرفًا كحد أقصى."]);
    expect(messages(z.email(), "nope")).toEqual(["البريد الإلكتروني غير صحيح."]);
    expect(messages(z.object({ a: z.string() }), {})).toEqual(["هذا الحقل مطلوب."]);
    expect(messages(z.array(z.string()).min(1), [])).toEqual(["اختر 1 على الأقل."]);
    expect(messages(z.literal(true), false)).toEqual(["قيمة غير صالحة."]);
  });

  it("keeps a schema's own message", () => {
    expect(messages(z.string().min(2, { message: "مخصص" }), "x")).toEqual(["مخصص"]);
  });
});
