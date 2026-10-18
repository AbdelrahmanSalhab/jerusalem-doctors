import { LoginForm } from "./LoginForm";
import { isPhoneAuthDisabled } from "@/lib/auth/session";
import { SupportContact } from "@/components/SupportContact";

export const dynamic = "force-dynamic";

const STATUS_NOTICE: Record<string, string> = {
  inactive: "حسابك غير مفعّل حاليًا. إن كان هذا خطأ، تواصل مع الإدارة.",
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
        <section className="mb-4 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <p>تسجيل الدخول قيد الإعداد حاليًا. سيُفعّل قريبًا.</p>
        </section>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          {notice}
        </p>
      )}
      <LoginForm />
      <SupportContact />
    </main>
  );
}
