import { LoginForm } from "./LoginForm";
import { isPhoneAuthDisabled } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="mb-2 text-2xl font-bold">تسجيل الدخول</h1>
      <p className="mb-6 text-foreground/70">
        أدخل رقم هاتفك المسجّل، وسيتم إرسال رمز التحقق عبر رسالة نصية.
      </p>
      {isPhoneAuthDisabled() && (
        <section className="mb-4 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <p>تسجيل الدخول قيد الإعداد حاليًا. سيُفعّل قريبًا.</p>
        </section>
      )}
      <LoginForm />
    </main>
  );
}
