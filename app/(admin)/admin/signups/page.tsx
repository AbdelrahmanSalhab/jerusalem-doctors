import { UnfinishedList, type UnfinishedRow } from "./UnfinishedList";
import { auditTime } from "@/lib/auditText";
import { requireAdmin } from "@/lib/auth/session";
import { cachedSpecialties } from "@/lib/cachedReads";
import { licenseDisplay } from "@/lib/licenseStatus";
import { formatPhoneDisplay } from "@/lib/normalize/phone";
import { KEEP_DAYS, keepCutoff } from "@/lib/signup/unfinished";
import { codeSummary, countBySignup, NO_CODES } from "@/lib/otp/summary";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

interface Payload {
  existing_doctor_id?: string;
  arabic_first_name?: string;
  arabic_family_name?: string;
  license_number?: string;
  license_region?: string;
  license_verification_status?: string | null;
  specialty_ids?: string[];
  resume_form?: unknown;
}

/** Signups that got an SMS code and never entered it, newest first: one per
 *  phone, and none whose phone has since joined. */
export default async function UnfinishedSignupsPage() {
  // The (admin) layout's check alone is not enough: Next can render this
  // page without re-running the layout. requireAdmin is request-cached.
  await requireAdmin();
  const service = createSupabaseServiceClient();
  const [pending, specialties] = await Promise.all([
    service
      .from("pending_signups")
      .select("id, phone_e164, payload, created_at, reminded_at")
      .gte("created_at", keepCutoff())
      .order("created_at", { ascending: false }),
    cachedSpecialties().catch(() => []),
  ]);
  if (pending.error) throw pending.error;

  // A returning phone's sign-in attempt is not a signup.
  const signups = (pending.data ?? []).filter((r) => !(r.payload as Payload).existing_doctor_id);
  const phones = [...new Set(signups.map((r) => r.phone_e164))];
  const joined = phones.length
    ? await service.from("doctors").select("phone_e164").in("phone_e164", phones)
    : { data: [], error: null };
  if (joined.error) throw joined.error;
  const joinedPhones = new Set((joined.data ?? []).map((d) => d.phone_e164));
  const specialtyName = new Map(specialties.map((s) => [s.id, s.name_ar]));

  const seen = new Set<string>();
  const rows: UnfinishedRow[] = [];
  for (const r of signups) {
    if (joinedPhones.has(r.phone_e164) || seen.has(r.phone_e164)) continue;
    seen.add(r.phone_e164);
    const p = r.payload as Payload;
    rows.push({
      id: r.id,
      name: [p.arabic_first_name, p.arabic_family_name].filter(Boolean).join(" ") || "بلا اسم",
      phone: formatPhoneDisplay(r.phone_e164),
      license: p.license_number ?? "",
      licenseLabel: licenseDisplay({ status: p.license_verification_status, region: p.license_region }).label,
      specialties: (p.specialty_ids ?? []).map((id) => specialtyName.get(id)).filter((n): n is string => Boolean(n)),
      started: auditTime(r.created_at),
      reminded: r.reminded_at ? auditTime(r.reminded_at) : null,
      canResume: Boolean(p.resume_form),
      codes: "",
    });
  }

  // What happened at the code step, per signup: one query for the page.
  const ids = rows.map((r) => r.id);
  const events = ids.length
    ? await service
        .from("usage_events")
        .select("kind, meta")
        .in("kind", ["otp_refused", "otp_locked", "otp_resent", "sms_delivered", "sms_undelivered", "sms_voice"])
        .filter("meta->>signup", "in", `(${ids.join(",")})`)
    : { data: [], error: null };
  if (events.error) throw events.error;
  const byId = countBySignup(events.data ?? []);
  const withCodes = rows.map((r) => ({ ...r, codes: codeSummary(byId.get(r.id) ?? NO_CODES) }));

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-bold">تسجيلات لم تكتمل</h1>
      <p className="text-sm text-muted">
        أطباء ملؤوا نموذج التسجيل ولم يُدخلوا رمز التحقق. «تذكير» يفتح واتساب برسالة فيها رابط يعيد فتح النموذج
        كما تركوه. يُحذف كل تسجيل بعد {KEEP_DAYS} يومًا.
      </p>
      <UnfinishedList rows={withCodes} />
    </main>
  );
}
