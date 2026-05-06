export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 py-24 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        دليل أطباء القدس
      </h1>
      <p className="text-lg leading-relaxed text-foreground/80">
        منصة مهنية مغلقة تساعد الأطباء المسجلين على العثور على زملائهم
        والتواصل معهم بسهولة حسب الاسم أو التخصص.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <a
          href="/login"
          className="rounded-md bg-foreground px-6 py-3 text-background hover:opacity-90"
        >
          تسجيل الدخول
        </a>
        <a
          href="/signup"
          className="rounded-md border border-foreground px-6 py-3 hover:bg-foreground/5"
        >
          إنشاء حساب جديد
        </a>
      </div>
    </main>
  );
}
