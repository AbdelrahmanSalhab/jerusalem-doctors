// Arabic messages for zod issues that reach a form as field errors. Schemas
// that set their own message keep it; this only replaces zod's English
// defaults ("Too small: expected string to have >=2 characters").
// Imported for its side effect by lib/api/respond.ts, which every route uses.

import { z } from "zod";

export function arabicIssueMessage(issue: z.core.$ZodRawIssue): string {
  switch (issue.code) {
    case "too_small":
      if (issue.origin === "string") return `قصير جدًا: ${issue.minimum} أحرف على الأقل.`;
      if (issue.origin === "array") return `اختر ${issue.minimum} على الأقل.`;
      return "القيمة أصغر من المسموح.";
    case "too_big":
      if (issue.origin === "string") return `طويل جدًا: ${issue.maximum} حرفًا كحد أقصى.`;
      if (issue.origin === "array") return `${issue.maximum} كحد أقصى.`;
      return "القيمة أكبر من المسموح.";
    case "invalid_format":
      return issue.format === "email" ? "البريد الإلكتروني غير صحيح." : "الصيغة غير صحيحة.";
    case "invalid_type":
      return issue.input === undefined ? "هذا الحقل مطلوب." : "قيمة غير صالحة.";
    default:
      return "قيمة غير صالحة.";
  }
}

z.config({ customError: arabicIssueMessage });
