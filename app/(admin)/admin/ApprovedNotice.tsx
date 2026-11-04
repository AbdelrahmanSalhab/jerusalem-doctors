"use client";

// Shown right after an admin accepts a doctor. Doctors get no push, so the
// admin tells them: one tap opens WhatsApp with the message written, and the
// tap is logged (approval_notified) so there is a record that someone did.
// The message only says "you are listed" when the doctor is: an accepted
// doctor who is hidden, or without consent, is not.

import { buildWhatsAppLink } from "@/lib/whatsapp";

export const APPROVED_MESSAGE = (firstName: string, listed: boolean) =>
  `السلام عليكم د. ${firstName}، راجعنا طلبك وقبلنا عضويتك في دليل أطباء القدس. ` +
  (listed ? "صار اسمك ظاهرًا للأطباء في الدليل. أهلًا بك." : "إن لم يظهر اسمك في الدليل بعد فراسلنا هنا ونرى السبب.");

export function ApprovedNotice({
  doctorId,
  phone,
  firstName,
  listed,
}: {
  doctorId: string;
  phone: string;
  firstName: string;
  listed: boolean;
}) {
  return (
    <p role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-success-line bg-success-bg px-3 py-2 text-sm text-success">
      <span>قُبل الطبيب. أخبره بالقبول:</span>
      <a
        href={buildWhatsAppLink(phone, APPROVED_MESSAGE(firstName, listed))}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          void fetch(`/api/admin/doctors/${doctorId}/notified`, { method: "POST", keepalive: true }).catch(() => {});
        }}
        className="rounded-md border border-success-line bg-surface px-3 py-1 font-semibold hover:opacity-90"
      >
        أرسل رسالة واتساب
      </a>
    </p>
  );
}
