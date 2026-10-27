// The code step, last 7 days (otp_stats, 20261027113048_otp_events): did
// texts arrive, how fast against the code's lifetime, how many codes were
// refused, and who is stuck. Doctors reported "two codes, both wrong" when a
// code lived 60 seconds; this says whether that is still happening.

import Link from "next/link";
import { Section, Tile, TileGrid } from "@/components/AdminParts";
import { OTP_VALID_SECONDS, validityText } from "@/lib/otp/expiry";

export interface OtpStats {
  sent: number;
  send_ms_p50: number | null;
  send_ms_max: number | null;
  delivered: number;
  undelivered: number;
  voice: number;
  delay_p50: number | null;
  delay_max: number | null;
  late: number;
  refused: number;
  locked: number;
  resent: number;
  logins_ok: number;
  signups_started: number;
  stuck_signups: number;
  stuck_logins: { id: string; name: string; refused: number; last_at: string }[];
}

/** «مرة» / «مرتين» / «3 مرات» / «11 مرة». */
const times = (n: number) => (n === 1 ? "مرة" : n === 2 ? "مرتين" : n <= 10 ? `${n} مرات` : `${n} مرة`);

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n * 100) / of)}%` : "0%");

export function OtpSection({ stats }: { stats: OtpStats | null }) {
  if (!stats) return null;
  const reports = stats.delivered + stats.undelivered + stats.voice;
  return (
    <Section
      title="رموز التحقق (آخر 7 أيام)"
      note={`الرمز صالح لمدة ${validityText()}. تقارير التسليم من SMS4FREE؛ إن بقيت صفرًا فقد تكون ميزة غير مفعّلة في الحساب.`}
    >
      <TileGrid>
        <Tile label="رسائل أُرسلت" value={stats.sent} sub={stats.send_ms_p50 !== null ? `قبلها SMS4FREE خلال ${stats.send_ms_p50} ms عادةً` : undefined} />
        <Tile label="وصلت" value={stats.delivered} sub={reports ? `${pct(stats.delivered, reports)} من التقارير` : "لا تقارير بعد"} />
        <Tile
          label="وصلت متأخرة"
          value={stats.late}
          sub={stats.delay_p50 !== null ? `عادةً خلال ${stats.delay_p50} ث، أبطؤها ${stats.delay_max} ث` : undefined}
          tone={stats.late > 0 ? "warn" : "plain"}
        />
        <Tile label="لم تصل" value={stats.undelivered} tone={stats.undelivered > 0 ? "warn" : "plain"} />
        <Tile label="مكالمة صوتية (كوشير)" value={stats.voice} />
        <Tile label="رموز مرفوضة" value={stats.refused} tone={stats.refused > 0 ? "warn" : "plain"} />
        <Tile label="طلبات رمز جديد" value={stats.resent} />
        <Tile label="تجاوز المحاولات" value={stats.locked} tone={stats.locked > 0 ? "warn" : "plain"} />
      </TileGrid>
      {(stats.stuck_signups > 0 || stats.stuck_logins.length > 0) && (
        <div className="space-y-2 rounded-lg border border-warn-line bg-warn-bg p-3 text-sm text-warn">
          <p className="font-medium">عالقون عند رمز التحقق</p>
          {stats.stuck_signups > 0 && (
            <p>
              {stats.stuck_signups} تسجيل رُفض رمزه ولم يكتمل:{" "}
              <Link href="/admin/signups" className="underline">
                تسجيلات لم تكتمل
              </Link>
            </p>
          )}
          {stats.stuck_logins.length > 0 && (
            <ul className="list-disc space-y-0.5 ps-5">
              {stats.stuck_logins.map((d) => (
                <li key={d.id}>
                  د. {d.name}: رُفض رمزه {times(d.refused)}، ولم يدخل بعدها
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}

/** Seconds of the code's lifetime, for otp_stats' "late" count. */
export const OTP_LATE_AFTER = OTP_VALID_SECONDS;
