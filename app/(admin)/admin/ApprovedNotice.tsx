// Shown right after an admin accepts a doctor. Doctors get no push, so the
// admin tells them: one tap opens WhatsApp with the message written.

import { buildWhatsAppLink } from "@/lib/whatsapp";

export const APPROVED_MESSAGE = (firstName: string) =>
  `السلام عليكم د. ${firstName}، راجعنا طلبك وقبلنا عضويتك في دليل أطباء القدس. صار اسمك ظاهرًا للأطباء في الدليل. أهلًا بك.`;

export function ApprovedNotice({ phone, firstName }: { phone: string; firstName: string }) {
  return (
    <p role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-success-line bg-success-bg px-3 py-2 text-sm text-success">
      <span>قُبل الطبيب. أخبره بالقبول:</span>
      <a
        href={buildWhatsAppLink(phone, APPROVED_MESSAGE(firstName))}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md border border-success-line bg-surface px-3 py-1 font-semibold hover:opacity-90"
      >
        أرسل رسالة واتساب
      </a>
    </p>
  );
}
