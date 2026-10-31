import { Suspense } from "react";
import { VerifyForm } from "./VerifyForm";

export const dynamic = "force-dynamic";

export default function VerifyPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="mb-2 text-2xl font-bold">رمز التحقق</h1>
      <p className="mb-6 text-foreground/70">
        أدخل الرمز المكوّن من 6 أرقام من الرسالة النصية (SMS).
      </p>
      <Suspense>
        <VerifyForm />
      </Suspense>
    </main>
  );
}
