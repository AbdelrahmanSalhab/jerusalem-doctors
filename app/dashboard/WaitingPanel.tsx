// What a doctor sees until an admin accepts them (#16). Every new account is
// reviewed by a person, so this is the first thing a new doctor reads: that we
// have them, what happens next, and what they can do meanwhile. It promises no
// time and no channel beyond the one the admins actually use (a WhatsApp
// message to the phone they signed up with).

import Link from "next/link";

type StepState = "done" | "now" | "next";

const STEPS: { state: StepState; title: string; text: string }[] = [
  { state: "done", title: "تحقّقنا من هاتفك", text: "أكّدت أن الرقم رقمك برمز الرسالة." },
  { state: "now", title: "تراجع الإدارة طلبك", text: "يتأكد أحد المشرفين من هويتك وترخيصك بنفسه." },
  { state: "next", title: "يظهر اسمك في الدليل", text: "يجدك زملاؤك بالاسم والتخصص ومكان العمل." },
];

function Mark({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="grid size-9 place-items-center rounded-full" style={{ background: "var(--success-fg)" }}>
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="var(--surface)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      </span>
    );
  }
  if (state === "now") {
    return (
      <span className="relative grid size-9 place-items-center">
        <span className="absolute inset-0 rounded-full bg-warn-solid/30 motion-safe:animate-ping" aria-hidden />
        <span className="relative grid size-9 place-items-center rounded-full border-2 border-warn-solid bg-warn-bg">
          <span className="size-2.5 rounded-full bg-warn-solid" />
        </span>
      </span>
    );
  }
  return <span className="size-9 rounded-full border-2 border-dashed border-line bg-surface" aria-hidden />;
}

export function WaitingPanel({ firstName }: { firstName: string }) {
  return (
    <section
      aria-labelledby="waiting-title"
      className="overflow-hidden rounded-2xl border border-warn-line bg-surface shadow-sm"
    >
      <div className="bg-warn-bg px-5 py-6 text-center sm:px-8 sm:py-8">
        <span className="mx-auto mb-3 grid size-14 place-items-center rounded-full border border-warn-line bg-surface">
          <svg viewBox="0 0 24 24" className="size-7 text-warn-solid" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3 4.5 6v5.5c0 4.4 3 8.2 7.5 9.5 4.5-1.3 7.5-5.1 7.5-9.5V6L12 3Z" />
            <path d="m9 12 2.2 2.2L15.5 10" />
          </svg>
        </span>
        <h2 id="waiting-title" className="text-xl font-bold text-warn sm:text-2xl">
          استلمنا طلبك يا د. {firstName}
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-foreground/80 sm:text-base">
          نراجع كل حساب جديد بأنفسنا ليبقى الدليل موثوقًا لك ولزملائك وللمرضى. حين نقبل طلبك
          سنراسلك على واتساب على الرقم الذي سجّلت به.
        </p>
      </div>

      <ol className="grid gap-0 px-5 py-6 sm:grid-cols-3 sm:gap-4 sm:px-8 sm:py-8">
        {STEPS.map((step, i) => (
          <li key={step.title} className="relative flex gap-4 pb-6 last:pb-0 sm:flex-col sm:items-center sm:gap-3 sm:pb-0 sm:text-center" aria-current={step.state === "now" ? "step" : undefined}>
            {i < STEPS.length - 1 && (
              <>
                <span
                  className={"absolute start-[17px] top-9 bottom-0 w-0.5 sm:hidden " + (step.state === "done" ? "bg-success-line" : "bg-line")}
                  aria-hidden
                />
                <span
                  className={"absolute top-[17px] hidden h-0.5 start-[calc(50%+26px)] end-[calc(-50%+26px)] sm:block " + (step.state === "done" ? "bg-success-line" : "bg-line")}
                  aria-hidden
                />
              </>
            )}
            <Mark state={step.state} />
            <div className="min-w-0 pt-0.5">
              <p className={"font-semibold " + (step.state === "next" ? "text-muted" : "")}>
                {step.state !== "now" && <span className="sr-only">{step.state === "done" ? "تمّ: " : "لاحقًا: "}</span>}
                {step.title}
                {step.state === "now" && (
                  <span className="ms-2 rounded-full border border-warn-line bg-warn-bg px-2 py-0.5 text-xs font-medium text-warn">الآن</span>
                )}
              </p>
              <p className="mt-0.5 text-sm text-muted">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-3 border-t border-line bg-background/60 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p className="text-foreground/80">في هذه الأثناء يمكنك البحث في الدليل أدناه، وإكمال ملفك ليكون جاهزًا حين تقبلك الإدارة.</p>
        <Link
          href="/profile"
          className="shrink-0 rounded-md border border-line bg-surface px-4 py-2 text-center font-semibold hover:bg-foreground/5"
        >
          أكمل ملفي
        </Link>
      </div>
    </section>
  );
}
