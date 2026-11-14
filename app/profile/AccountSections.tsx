// The profile page's closing sections: contact the developer, and request
// account deletion.

import { useRouter } from "next/navigation";
import { LinktreeIcon, WhatsAppIcon } from "@/components/BrandIcons";
import { Section } from "./ProfileFields";

const LINKTREE_URL = "https://linktr.ee/SalhabBrothers";
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
          className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[#25d366] px-4 py-2.5 text-center font-medium text-white hover:opacity-90"
        >
          <WhatsAppIcon />
          مراسلة المطوّر عبر واتساب
        </a>
        <a
          href={LINKTREE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 items-center justify-center gap-2 rounded-md border border-foreground/20 px-4 py-2.5 text-center hover:bg-foreground/5"
        >
          <LinktreeIcon />
          رابط الفريق على Linktree
        </a>
      </div>
    </Section>
  );
}

export function DeleteAccountSection({ onError }: { onError: (msg: string) => void }) {
  const router = useRouter();
  const requestDelete = async () => {
    const ok = window.confirm(
      "هل أنت متأكد؟ سيتم إخفاء حسابك من البحث فورًا، وسيقوم المسؤول بالمراجعة.",
    );
    if (!ok) return;
    const res = await fetch("/api/profile/delete-request", { method: "POST" });
    if (res.ok) {
      // The route signed the session out; refresh so the header follows.
      router.replace("/login?status=deleted");
      router.refresh();
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
        className="rounded-md border border-danger-line px-4 py-2 text-danger hover:bg-danger-bg pointer-coarse:min-h-11"
      >
        طلب حذف الحساب
      </button>
    </Section>
  );
}
