// Adding the directory to the home screen, last 30 days (#150): how many
// doctors reached each step, by platform, from install_funnel(). Server
// component: plain markup.

import { Section } from "@/components/AdminParts";
import type { InstallKind } from "@/lib/usage";

export interface FunnelRow {
  kind: string;
  /** null: every platform together, each doctor once. */
  platform: string | null;
  events: number;
  doctors: number;
}

const STEPS: [InstallKind, string][] = [
  ["install_invite_shown", "رأوا الدعوة"],
  ["install_invite_snoozed", "أجّلوها"],
  ["install_click", "ضغطوا «تثبيت» أو «طريقة الإضافة»"],
  ["install_accepted", "وافقوا في نافذة التثبيت"],
  ["install_completed", "ثبّتوه (يؤكده المتصفح)"],
  ["install_app_opened", "فتحوه من الشاشة الرئيسية"],
];

const PLATFORMS: [key: string | null, label: string][] = [
  ["iphone", "iPhone"],
  ["android", "Android"],
  ["in-app", "داخل تطبيق"],
  ["other", "حاسوب"],
  [null, "المجموع"],
];

export function InstallSection({ rows }: { rows: FunnelRow[] }) {
  const doctors = new Map(rows.map((r) => [`${r.kind}|${r.platform ?? ""}`, r.doctors]));
  return (
    <Section
      title="الإضافة إلى الشاشة الرئيسية (آخر 30 يومًا)"
      note="عدد الأطباء في كل خطوة، والمجموع يعدّ الطبيب مرة واحدة. iPhone لا يؤكد التثبيت، فالمقياس الحقيقي هو من فتحه من الشاشة الرئيسية."
    >
      {rows.length === 0 ? (
        <p className="rounded-lg border border-line p-3 text-sm">يبدأ العدّ من الآن؛ تظهر الأرقام مع أول دعوة.</p>
      ) : (
        // Scrolls sideways on a phone, so it takes keyboard focus.
        <div role="region" aria-label="خطوات الإضافة" tabIndex={0} className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-foreground/5 text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-normal">الخطوة</th>
                {PLATFORMS.map(([key, label]) => (
                  <th key={label} scope="col" className="px-3 py-2 text-start font-normal">
                    {key === null ? <strong className="font-semibold text-foreground">{label}</strong> : label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {STEPS.map(([kind, label]) => (
                <tr key={kind}>
                  <th scope="row" className="px-3 py-2 text-start font-normal">{label}</th>
                  {PLATFORMS.map(([key, platform]) => (
                    <td key={platform} className={key === null ? "px-3 py-2 font-semibold" : "px-3 py-2"}>
                      {doctors.get(`${kind}|${key ?? ""}`) ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
