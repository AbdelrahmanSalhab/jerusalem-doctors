import { ReportForm } from "./ReportForm";

export const metadata = { title: "الإبلاغ عن ملف" };

/** Reporting a profile that is not who it says, for anyone, signed in or
 *  not: the doctor it impersonates may have no account here. Linked from the
 *  signup's "licence already registered" error and the dashboard's "this
 *  number is already registered" notice; ?license= fills the licence in. */
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const license = (await searchParams).license;
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="mb-2 text-3xl font-bold">الإبلاغ عن ملف</h1>
      <p className="mb-6 text-foreground/70">
        هل سجّل أحدهم برقم ترخيصك أو برقم هاتفك، أو وجدت ملفًا لا يخص صاحبه؟ أخبرنا وسنراجعه ونتواصل معك.
        لا يُعلَّق أي حساب بسبب بلاغ وحده.
      </p>
      <ReportForm license={typeof license === "string" ? license.slice(0, 20) : ""} />
    </main>
  );
}
