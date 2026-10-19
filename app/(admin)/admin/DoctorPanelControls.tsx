"use client";

// Everything in the panel that writes: the three switches, the career stage,
// the featured slot, and deleting the account.
//
// One client component owns the save call so a server-rendered panel body can
// stay plain markup, and so a failure reports once, inline, instead of through
// window.alert.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { StateSwitches, type SwitchDoctor } from "./StateSwitches";
import { apiErrorMessage, fieldErrorMessage } from "@/lib/client/apiError";
import {
  RESIDENCY_YEAR_MIN,
  residencyYearMax,
  STAGE_BY_KEY,
  STAGE_OPTIONS,
  stageFromCareerStage,
  type Stage,
} from "@/lib/careerStage";
import { FEATURED_KINDS, FEATURED_LABEL, type FeaturedKind } from "@/lib/directory";

export interface ControlsDoctor extends SwitchDoctor {
  id: string;
  career_stage: "resident" | "specialist" | null;
  residency_start_year: number | null;
  featured: FeaturedKind | null;
  seeking_work: boolean;
}

export function DoctorPanelControls({ doctor, closeHref }: { doctor: ControlsDoctor; closeHref: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [, startTransition] = useTransition();

  const patch = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/doctors/${doctor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({
          ok: false,
          text: fieldErrorMessage(payload?.fields) ?? apiErrorMessage(payload?.code, "تعذّر حفظ التغيير. حاول مجددًا."),
        });
        return false;
      }
      setNotice({ ok: true, text: "حُفظ التغيير." });
      startTransition(() => router.refresh());
      return true;
    } catch {
      setNotice({ ok: false, text: "تعذّر الاتصال. تحقّق من الشبكة وحاول مجددًا." });
      return false;
    } finally {
      setBusy(false);
    }
  };

  // طب عام writes career_stage = NULL. Unlike signup it does not attach the
  // الطب العام specialty; the admin screens do not manage specialties.
  const setStage = (stage: Stage) =>
    patch({
      career_stage: STAGE_BY_KEY[stage].careerStage,
      ...(stage === "resident" ? {} : { residency_start_year: null }),
    });

  const currentStage = stageFromCareerStage(doctor.career_stage);

  return (
    <div className="flex flex-col gap-5">
      {notice && (
        <p
          role={notice.ok ? "status" : "alert"}
          className={
            "rounded-md border px-3 py-2 text-sm " +
            (notice.ok ? "border-success-line bg-success-bg text-success" : "border-danger-line bg-danger-bg text-danger")
          }
        >
          {notice.text}
        </p>
      )}

      <StateSwitches doctor={doctor} busy={busy} onPatch={patch} />

      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">المرحلة المهنية</h3>
        <div className="inline-flex w-fit overflow-hidden rounded-md border border-line">
          {STAGE_OPTIONS.map((o) => (
            <button
              key={o.stage}
              type="button"
              disabled={busy}
              onClick={() => setStage(o.stage)}
              className={
                "border-e border-line px-3 py-1.5 text-sm last:border-e-0 disabled:opacity-50 " +
                (currentStage === o.stage ? "bg-primary text-primary-fg" : "hover:bg-foreground/5")
              }
            >
              {o.shortLabel}
            </button>
          ))}
        </div>
        {doctor.career_stage === "resident" && (
          <input
            type="number"
            dir="ltr"
            disabled={busy}
            min={RESIDENCY_YEAR_MIN}
            max={residencyYearMax()}
            defaultValue={doctor.residency_start_year ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim();
              const next = v === "" ? null : Number(v);
              if (next === (doctor.residency_start_year ?? null)) return;
              void patch({ residency_start_year: next });
            }}
            placeholder="سنة بداية التخصص"
            aria-label="سنة بداية التخصص"
            className="w-40 rounded-md border border-line bg-surface px-3 py-1.5 text-base"
          />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">العرض في لوحة البحث</h3>
        <select
          aria-label="العرض في لوحة البحث"
          disabled={busy}
          value={doctor.featured ?? ""}
          onChange={(e) => void patch({ featured: e.target.value || null })}
          className="w-fit rounded-md border border-line bg-surface px-3 py-1.5 text-base"
        >
          <option value="">غير مميز</option>
          {FEATURED_KINDS.map((k) => (
            <option key={k} value={k}>
              {FEATURED_LABEL[k]}
            </option>
          ))}
        </select>
        {doctor.featured === "graduate" && !doctor.seeking_work && (
          <p className="text-sm text-warn">لا يظهر: لم يفعّل &quot;أبحث عن فرصة عمل&quot;.</p>
        )}
      </section>

      <DangerZone doctor={doctor} closeHref={closeHref} busy={busy} setBusy={setBusy} setNotice={setNotice} />
    </div>
  );
}

/** Erasing the account for good: the row, the photo and the login. Offered
 *  only once the account is closed, which is what the API enforces too. */
function DangerZone({
  doctor,
  closeHref,
  busy,
  setBusy,
  setNotice,
}: {
  doctor: ControlsDoctor;
  closeHref: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setNotice: (n: { ok: boolean; text: string } | null) => void;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const name = `${doctor.arabic_first_name} ${doctor.arabic_family_name}`;

  if (doctor.is_active) {
    return (
      <section className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className="text-base font-semibold">الحذف النهائي</h3>
        <p className="text-sm text-muted">أغلق الحساب أولًا؛ الحذف النهائي متاح للحسابات المغلقة فقط.</p>
      </section>
    );
  }

  const remove = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/doctors/${doctor.id}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setNotice({ ok: false, text: apiErrorMessage(payload?.code, "تعذّر الحذف. حاول مجددًا.") });
        return;
      }
      // The doctor is gone, so the panel has nothing left to show.
      router.push(closeHref, { scroll: false });
      router.refresh();
    } catch {
      setNotice({ ok: false, text: "تعذّر الاتصال. تحقّق من الشبكة وحاول مجددًا." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-danger-line bg-danger-bg p-3">
      <h3 className="text-base font-semibold text-danger">الحذف النهائي</h3>
      <p className="text-sm">
        يُحذف حساب د. {name} وكل بياناته وصورته وحساب دخوله، ولا يمكن التراجع. اكتب «حذف» للتأكيد.
      </p>
      <div className="flex gap-2">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label="اكتب حذف للتأكيد"
          className="w-28 rounded-md border border-line bg-surface px-3 py-1.5 text-base"
        />
        <button
          type="button"
          disabled={busy || typed.trim() !== "حذف"}
          onClick={remove}
          className="rounded-md border border-danger-solid bg-danger-solid px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-40"
        >
          حذف نهائي
        </button>
      </div>
    </section>
  );
}
