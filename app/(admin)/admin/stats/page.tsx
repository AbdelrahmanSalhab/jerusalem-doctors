import { daysSince, fetchAdminStats, pct } from "@/lib/adminStats";
import { requireAdmin } from "@/lib/auth/session";
import { fetchAvailableSms } from "@/lib/otp/sms4free";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { Attention, BarList, DailyBars, Section, Tile, TileGrid } from "./StatsParts";

export const dynamic = "force-dynamic";

const LOW_SMS = 200;

/** Remaining SMS credit, or null when the provider can't be asked. */
async function smsCredit(): Promise<number | null> {
  try {
    return await fetchAvailableSms();
  } catch {
    return null;
  }
}

export default async function AdminStatsPage() {
  // The (admin) layout's check alone is not enough: Next can render this
  // page without re-running the layout. requireAdmin is request-cached.
  await requireAdmin();
  const [s, sms] = await Promise.all([
    fetchAdminStats(createSupabaseServiceClient()),
    smsCredit(),
  ]);
  const d = s.doctors;
  const a = s.attention;
  const u = s.usage;
  const pendingDays = daysSince(a.pending_oldest);
  const deletionDays = daysSince(a.deletion_oldest);
  const attentionTotal =
    a.pending + a.deletion_requests + a.clinics_missing_details + u.login_send_failed_24h +
    (sms !== null && sms < LOW_SMS ? 1 : 0);

  return (
    <main className="flex flex-col gap-10">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">الإحصائيات</h1>
        <p className="text-sm text-foreground/60" dir="ltr">
          {new Date(s.generated_at).toLocaleString("en-GB", { timeZone: "Asia/Jerusalem" })}
        </p>
      </header>

      <Section title="يحتاج انتباهك">
        {attentionTotal === 0 ? (
          <p className="rounded-lg border border-foreground/15 p-3 text-sm">لا شيء ينتظر. كل شيء على ما يرام.</p>
        ) : (
          <ul className="rounded-lg border border-amber-300 bg-amber-50 px-4 text-amber-950">
            {sms !== null && sms < LOW_SMS && (
              <Attention count={sms} text="رسالة SMS متبقية فقط في الرصيد. اشحن قبل أن يتوقف التسجيل والدخول." />
            )}
            <Attention
              count={u.login_send_failed_24h}
              text="رمز دخول فشل إرساله في آخر 24 ساعة (راجع Sentry ورصيد SMS)."
            />
            <Attention
              count={a.pending}
              text={`بانتظار الموافقة${pendingDays ? `، أقدمهم منذ ${pendingDays} يوم` : ""}.`}
              href="/admin?status=pending"
            />
            <Attention
              count={a.pending_not_found}
              text="منهم بترخيص لم يُعثر عليه في سجل الوزارة (يحتاج تحققًا يدويًا)."
              href="/admin?status=pending"
            />
            <Attention
              count={a.pending_mismatch}
              text="منهم بالاسم العبري لا يطابق السجل (تجاوزه الطبيب)."
              href="/admin?status=pending"
            />
            <Attention
              count={a.deletion_requests}
              text={`طلب حذف ينتظر الإتمام${deletionDays ? `، أقدمها منذ ${deletionDays} يوم` : ""}.`}
              href="/admin?status=suspended"
            />
            <Attention
              count={a.clinics_missing_details}
              text={`عيادة من ${a.clinics} بلا عنوان أو هاتف.`}
            />
          </ul>
        )}
      </Section>

      <Section title="الأطباء">
        <TileGrid>
          <Tile label="المجموع" value={d.total} />
          <Tile label="ظاهرون في الدليل" value={d.listed} sub={pct(d.listed, d.total)} />
          <Tile label="بانتظار الموافقة" value={d.pending} href="/admin?status=pending" tone={d.pending ? "warn" : "plain"} />
          <Tile label="معلّقون / طلبات حذف" value={d.suspended} href="/admin?status=suspended" />
          <Tile label="جدد آخر 24 ساعة" value={d.new_24h} />
          <Tile label="جدد آخر 7 أيام" value={d.new_7d} />
          <Tile label="جدد آخر 30 يومًا" value={d.new_30d} />
          <Tile label="يبحثون عن عمل" value={d.seeking_work} sub={pct(d.seeking_work, d.total)} />
        </TileGrid>
        <DailyBars label="تسجيلات جديدة" days={s.daily.map((x) => ({ day: x.day, value: x.signups }))} />
      </Section>

      <Section
        title="النشاط"
        note="الدخول يُسجَّل عند إدخال رمز فقط، والجلسة تبقى طويلًا، فالأرقام أقل من الاستخدام الفعلي."
      >
        <TileGrid>
          <Tile label="دخلوا آخر 7 أيام" value={s.activity.active_7d} sub={pct(s.activity.active_7d, d.total)} />
          <Tile label="دخلوا آخر 30 يومًا" value={s.activity.active_30d} sub={pct(s.activity.active_30d, d.total)} />
          <Tile label="بحثوا آخر 7 أيام" value={u.searchers_7d} sub={pct(u.searchers_7d, d.total)} />
          <Tile label="لم يدخلوا أبدًا" value={s.activity.never} sub={pct(s.activity.never, d.total)} />
        </TileGrid>
        <DailyBars label="أطباء بحثوا" days={s.daily.map((x) => ({ day: x.day, value: x.searchers }))} />
      </Section>

      <Section
        title="التسجيل والدخول (آخر 7 أيام)"
        note={u.since ? `يُجمع منذ ${u.since.slice(0, 10)}.` : "يبدأ الجمع من الآن."}
      >
        <TileGrid>
          <Tile label="بدأوا التسجيل" value={u.signup_started_7d} />
          <Tile
            label="أكملوا الرمز"
            value={s.signup_completed_7d}
            sub={u.signup_started_7d ? `${pct(s.signup_completed_7d, u.signup_started_7d)} ممن بدأوا` : undefined}
          />
          <Tile label="رموز دخول أُرسلت" value={u.login_code_sent_7d} />
          <Tile
            label="دخلوا بنجاح"
            value={u.login_succeeded_7d}
            sub={u.login_code_sent_7d ? `${pct(u.login_succeeded_7d, u.login_code_sent_7d)} من الرموز` : undefined}
          />
          <Tile
            label="حاولوا الدخول بلا حساب"
            value={u.login_unregistered_7d}
            sub="رقم غير مسجّل؛ قد يحتاجون للتسجيل أولًا"
          />
          <Tile
            label="فلتر تخصص بلا نتائج"
            value={u.filter_empty_7d}
            sub={`من ${u.searches_7d} عملية بحث`}
          />
        </TileGrid>
      </Section>

      <Section title="من هم الأطباء">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">المرحلة المهنية</h3>
            <BarList
              total={d.total}
              items={[
                { name: "طب عام", count: s.stage.general },
                { name: "طبيب مقيم", count: s.stage.resident },
                { name: "طبيب أخصائي", count: s.stage.specialist },
              ]}
            />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">جهة الترخيص</h3>
            <BarList
              total={d.total}
              items={[
                { name: "إسرائيلي فقط", count: s.license.il_only },
                { name: "فلسطيني فقط", count: s.license.ps_only },
                { name: "الاثنان", count: s.license.both },
              ]}
            />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">التحقق من الترخيص</h3>
            <BarList
              total={d.total}
              items={[
                { name: "مطابق للسجل", count: s.license.verified },
                { name: "تطابق تقريبي", count: s.license.soft_match },
                { name: "غير موجود في السجل", count: s.license.not_found },
                { name: "اسم غير مطابق (متجاوَز)", count: s.license.mismatch_overridden },
              ]}
            />
            <p className="text-xs text-foreground/60">
              الموافقة: تلقائية {d.approved_auto} · من الإدارة {d.approved_manual}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">أماكن العمل</h3>
            <BarList
              total={d.total}
              items={[
                { name: "مستشفى", count: s.workplace_types.hospital },
                { name: "عيادة", count: s.workplace_types.clinic },
                { name: "صندوق مرضى", count: s.workplace_types.hmo },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section title="التخصصات" note="كل تخصص فرعي محسوب ضمن تخصصه الرئيسي، والطبيب قد يُحسب في أكثر من تخصص.">
        <BarList total={d.total} items={s.domains} />
      </Section>

      <div className="grid gap-10 md:grid-cols-2">
        <Section title="أكثر المستشفيات">
          <BarList total={d.total} items={s.top_hospitals} />
        </Section>
        <Section
          title="تخصصات يبحثون عنها ولا يجدون أحدًا"
          note="فلتر تخصص أعاد صفر نتائج، آخر 30 يومًا. فرصة لدعوة أطباء من هذه التخصصات."
        >
          <BarList
            total={Math.max(1, ...s.empty_specialties.map((x) => x.count))}
            items={s.empty_specialties}
            empty="لا شيء: كل تخصص بُحث عنه وُجد فيه أطباء."
          />
        </Section>
      </div>

      <Section title="اكتمال الملفات" note="من ينقصه شيء يظهر أقل في البحث أو بطاقة أفقر.">
        <BarList
          total={d.total}
          items={[
            { name: "صورة شخصية", count: d.with_photo },
            { name: "نبذة", count: d.with_bio },
            { name: "مكان عمل واحد على الأقل", count: d.with_workplace },
          ]}
        />
      </Section>

      <Section title="حالة النظام">
        <TileGrid>
          <Tile
            label="رصيد رسائل SMS"
            value={sms === null ? "غير متاح" : sms}
            tone={sms !== null && sms < LOW_SMS ? "warn" : "plain"}
          />
          <Tile
            label="آخر مزامنة لسجل الوزارة"
            value={s.moh_sync ? (s.moh_sync.action === "moh_sync_completed" ? "نجحت" : "فشلت") : "لا يوجد"}
            sub={s.moh_sync ? `منذ ${daysSince(s.moh_sync.at)} يوم` : undefined}
            tone={s.moh_sync?.action === "moh_sync_failed" ? "warn" : "plain"}
          />
        </TileGrid>
      </Section>
    </main>
  );
}
