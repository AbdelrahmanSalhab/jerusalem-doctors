import Link from "next/link";
import { LoginForm } from "./LoginForm";
import { isPhoneAuthDisabled } from "@/lib/auth/session";
import { SupportContact } from "@/components/SupportContact";

export const dynamic = "force-dynamic";

const STATUS_NOTICE: Record<string, string> = {
  inactive: "حسابك غير مفعّل حاليًا: إما لم تُقبل عضويتك، أو أُغلق الحساب. تواصل مع الإدارة لمعرفة السبب.",
  deleted: "استلمنا طلب حذف حسابك وأخفيناه من البحث. ستكمل الإدارة الحذف قريبًا.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const notice = STATUS_NOTICE[(await searchParams).status ?? ""];
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="mb-2 text-2xl font-bold">تسجيل الدخول</h1>
      <p className="mb-6 text-foreground/70">
        أدخل رقم هاتفك المسجّل، وسيتم إرسال رمز التحقق في رسالة نصية (SMS).
      </p>
      {isPhoneAuthDisabled() && (
        <section className="mb-4 rounded border border-warn-line bg-warn-bg p-4 text-sm">
          <p>تسجيل الدخول قيد الإعداد حاليًا. سيُفعّل قريبًا.</p>
        </section>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded border border-warn-line bg-warn-bg p-4 text-sm">
          {notice}
        </p>
      )}
      <LoginForm />
      <SupportContact />
      {/* The installed app has no address bar, so an admin could not reach /login/dev. It
          is no secret (a password, a second factor and a rate limit guard it); it is not promoted. */}
      <p className="mt-6 text-center text-sm text-foreground/70">
        <Link href="/login/dev" className="underline">
          دخول المشرفين بالبريد وكلمة المرور
        </Link>
      </p>
    </main>
  );
}
