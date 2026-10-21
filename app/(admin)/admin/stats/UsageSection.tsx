// Measured usage, one row per day from metrics_daily (written by
// /api/cron/metrics), against the free-plan limits in lib/limits.ts. Server
// component: plain markup.

import { Section, Tile, TileGrid } from "@/components/AdminParts";
import { DB_LIMIT_BYTES, SMS_DAILY_CAP } from "@/lib/limits";

export interface MetricsDay {
  day: string;
  db_bytes: number;
  counts: Record<string, number>;
}

const COLUMNS: [key: string, label: string][] = [
  ["searches", "بحث"],
  ["sms_sent", "رسائل SMS"],
  ["logins", "دخول"],
  ["signups_completed", "تسجيل مكتمل"],
  ["contacts", "تواصل"],
  ["alerts", "تنبيهات"],
  ["registry_requests", "طلبات سجل الوزارة"],
];

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function UsageSection({ days }: { days: MetricsDay[] }) {
  if (days.length === 0) {
    return (
      <Section title="الاستخدام الفعلي">
        <p className="rounded-lg border border-line p-3 text-sm">
          لا قياسات بعد. يُسجَّل كل يوم بعد منتصف الليل (بتوقيت غرينتش).
        </p>
      </Section>
    );
  }
  const latest = days[0];
  const dbShare = latest.db_bytes / DB_LIMIT_BYTES;
  const smsPeak = Math.max(...days.map((d) => d.counts.sms_sent ?? 0));
  return (
    <Section
      title="الاستخدام الفعلي"
      note="مقيس يوميًا، لا تقديرًا. اليوم بتوقيت غرينتش. الحدود هي حدود الخطط المجانية."
    >
      <TileGrid>
        <Tile
          label="حجم قاعدة البيانات"
          value={mb(latest.db_bytes)}
          sub={`${Math.round(dbShare * 100)}٪ من ${mb(DB_LIMIT_BYTES)} (Supabase)`}
          tone={dbShare > 0.7 ? "warn" : "plain"}
        />
        <Tile
          label="أعلى رسائل SMS في يوم"
          value={smsPeak}
          sub={`من حد يومي ${SMS_DAILY_CAP}`}
          tone={smsPeak > SMS_DAILY_CAP * 0.7 ? "warn" : "plain"}
        />
      </TileGrid>
      {/* Scrolls sideways on a phone, so it takes keyboard focus. */}
      <div
        role="region"
        aria-label="الاستخدام اليومي"
        tabIndex={0}
        className="overflow-x-auto rounded-lg border border-line"
      >
        <table className="w-full text-sm tabular-nums">
          <thead className="bg-foreground/5 text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-normal">اليوم</th>
              {COLUMNS.map(([key, label]) => (
                <th key={key} scope="col" className="px-3 py-2 text-start font-normal">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {days.map((d) => (
              <tr key={d.day}>
                <th scope="row" className="whitespace-nowrap px-3 py-2 text-start font-normal" dir="ltr">
                  {d.day}
                </th>
                {COLUMNS.map(([key]) => (
                  <td key={key} className="px-3 py-2">
                    {d.counts[key] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
