// Email template for the signup verification link.
//
// Single template literal — no template engine. Arabic copy + LTR link.
// The plaintext fallback exists so spam filters and CLI mail readers can
// still use the link.

interface TemplateInput {
  arabicFirstName: string;
  verifyUrl: string;
  expiryHours: number;
}

export function renderSignupVerifyEmail(input: TemplateInput): {
  subject: string;
  html: string;
  text: string;
} {
  const safeName = escapeHtml(input.arabicFirstName);
  const safeUrl = escapeHtml(input.verifyUrl);
  const subject = "تأكيد البريد الإلكتروني — دليل أطباء القدس";

  const html = `<!doctype html>
<html dir="rtl" lang="ar">
  <body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
    <h1 style="font-size: 20px;">مرحبًا د. ${safeName}،</h1>
    <p>شكرًا على التسجيل في دليل أطبّاء القدس.</p>
    <p>للتحقق من بريدك الإلكتروني، اضغط الزر التالي:</p>
    <p style="text-align: center; margin: 32px 0;">
      <a href="${safeUrl}" dir="ltr" style="display: inline-block; padding: 12px 24px; background: #1a1a1a; color: #fff; text-decoration: none; border-radius: 6px;">تأكيد البريد</a>
    </p>
    <p style="color: #555; font-size: 14px;">صالح لمدة ${input.expiryHours} ساعة. إذا لم تطلب التسجيل، تجاهل هذه الرسالة.</p>
    <p style="color: #888; font-size: 12px; word-break: break-all;" dir="ltr">${safeUrl}</p>
  </body>
</html>`;

  const text = [
    `مرحبًا د. ${input.arabicFirstName}،`,
    "",
    "شكرًا على التسجيل في دليل أطبّاء القدس.",
    "",
    "للتحقق من بريدك الإلكتروني، افتح الرابط التالي:",
    input.verifyUrl,
    "",
    `صالح لمدة ${input.expiryHours} ساعة.`,
  ].join("\n");

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
