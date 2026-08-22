// Help/support WhatsApp link for doctors stuck during signup or login —
// distinct from the developer-credit link in SiteFooter. Renders nothing
// if NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER isn't configured, so it's a safe
// no-op until the number is set.

const SUPPORT_NUMBER = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER;

export function SupportContact() {
  if (!SUPPORT_NUMBER) return null;

  return (
    <p className="mt-4 text-center text-sm text-foreground/65">
      بحاجة لمساعدة؟{" "}
      <a
        href={`https://wa.me/${SUPPORT_NUMBER}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-[#25d366] hover:underline"
      >
        راسلنا عبر واتساب
      </a>
    </p>
  );
}
