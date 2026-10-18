// The profile page's closing sections: contact the developer, and request
// account deletion.

import { Section } from "./ProfileFields";

const LINKEDIN_URL = "https://www.linkedin.com/in/abdelrahman-salhab/";
const WHATSAPP_URL = "https://wa.me/972524209156";

export function HelpSection() {
  return (
    <Section title="بحاجة لمساعدة؟">
      <p className="text-sm text-foreground/75">
        لتعديل أي معلومة مقفلة، أو لطلب إخفاء كامل من البحث، تواصل مع
        المطوّر مباشرة.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-md bg-[#25d366] px-4 py-2.5 text-center font-medium text-white hover:opacity-90"
        >
          مراسلة المطوّر عبر واتساب
        </a>
        <a
          href={LINKEDIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-md border border-foreground/20 px-4 py-2.5 text-center hover:bg-foreground/5"
        >
          ملف LinkedIn
        </a>
      </div>
    </Section>
  );
}

export function DeleteAccountSection({ onError }: { onError: (msg: string) => void }) {
  const requestDelete = async () => {
    const ok = window.confirm(
      "هل أنت متأكد؟ سيتم إخفاء حسابك من البحث فورًا، وسيقوم المسؤول بالمراجعة.",
    );
    if (!ok) return;
    const res = await fetch("/api/profile/delete-request", { method: "POST" });
    if (res.ok) {
      window.location.href = "/";
    } else {
      onError("لم نتمكن من تسجيل طلب الحذف.");
    }
  };

  return (
    <Section title="حذف الحساب">
      <p className="text-sm text-foreground/75">
        عند الضغط على الزر، سيتم إخفاء حسابك من البحث فورًا، وستتم مراجعة
        طلبك من قبل المسؤول.
      </p>
      <button
        type="button"
        onClick={requestDelete}
        className="rounded-md border border-red-400 px-4 py-2 text-red-700 hover:bg-red-50"
      >
        طلب حذف الحساب
      </button>
    </Section>
  );
}
