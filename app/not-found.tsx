import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-xl flex-col items-center gap-4 px-6 py-24 text-center">
      <h1 className="text-5xl font-bold">404</h1>
      <h2 className="text-xl font-semibold">الصفحة غير موجودة</h2>
      <p className="text-foreground/70">
        الرابط الذي حاولت الوصول إليه غير صحيح أو تمّت إزالته.
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Link
          href="/"
          className="rounded-md bg-foreground px-5 py-2.5 text-background hover:opacity-90"
        >
          العودة إلى الرئيسية
        </Link>
        <Link
          href="/dashboard"
          className="rounded-md border border-foreground/20 px-5 py-2.5 hover:bg-foreground/5"
        >
          لوحة البحث
        </Link>
      </div>
    </main>
  );
}
