"use client";

// Correcting a licence number: search the registry, read the result, then
// save it deliberately.
//
// Two calls, not one, because this field is the account's identity. A typo
// saved straight away would overwrite a verified licence with a miss, and the
// admin would have no way to know what it used to be.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiErrorMessage, fieldErrorMessage } from "@/lib/client/apiError";
import { licenseStatusLabel, toneChip, type StatusTone } from "@/lib/licenseStatus";
import type { LicenseExplanation } from "@/lib/moh/explain";

interface CheckResult {
  checked_number: string;
  candidates: string[];
  status: "verified" | "soft_match" | "name_mismatch" | "not_found";
  column_status: string | null;
  source: "mirror" | "live" | "none";
  registry: { firstName: string | null; familyName: string | null; specialtyHe: string | null } | null;
  explanation: LicenseExplanation;
  checkable: boolean;
  our_name: { firstName: string | null; familyName: string | null };
  /** The registry's spelling, when taking it would make the match exact. */
  adoptable_name: { first: string; family: string } | null;
  duplicate_of: { id: string; name: string } | null;
  same_as_stored: boolean;
  stored_status: string | null;
}

interface NameCandidate {
  licenseNumber: string;
  firstName: string;
  familyName: string;
  specialtyHe: string | null;
  kind: "exact" | "family";
  distance: number | null;
  heldBy: { id: string; name: string } | null;
}

const TONE_BOX: Record<StatusTone, string> = {
  success: "border-success-line bg-success-bg",
  warn: "border-warn-line bg-warn-bg",
  danger: "border-danger-line bg-danger-bg",
  neutral: "border-line bg-background/60",
};

export function LicenseCheckPanel({
  doctorId,
  slot,
  region,
  storedNumber,
}: {
  doctorId: string;
  slot: "primary" | "secondary";
  region: "IL" | "PS";
  storedNumber: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState(storedNumber);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [byName, setByName] = useState<{ hasName: boolean; candidates: NameCandidate[] } | null>(null);

  const post = async (path: "check" | "save" | "find-by-name", body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/doctors/${doctorId}/license/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    return { ok: res.ok, payload };
  };

  const search = async (n = number) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    setResult(null);
    setOverride(false);
    try {
      const { ok, payload } = await post("check", { slot, license_number: n, region });
      if (!ok) {
        setError(fieldErrorMessage(payload?.fields) ?? apiErrorMessage(payload?.code, "تعذّر البحث. حاول مجددًا."));
        return;
      }
      setResult(payload as CheckResult);
    } catch {
      setError("تعذّر الاتصال. تحقّق من الشبكة وحاول مجددًا.");
    } finally {
      setBusy(false);
    }
  };

  // Candidates by Hebrew name: a lead for the admin to confirm with the
  // doctor, never a fix. Picking one only runs the usual check on it.
  const findByName = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const { ok, payload } = await post("find-by-name", {});
      if (!ok) {
        setError(apiErrorMessage(payload?.code, "تعذّر البحث. حاول مجددًا."));
        return;
      }
      setByName({ hasName: payload.has_name, candidates: payload.candidates });
    } catch {
      setError("تعذّر الاتصال. تحقّق من الشبكة وحاول مجددًا.");
    } finally {
      setBusy(false);
    }
  };

  const save = async (adoptName = false) => {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const { ok, payload } = await post("save", {
        slot,
        license_number: result.checked_number,
        region,
        expected_status: result.column_status,
        ...(adoptName ? { adopt_registry_name: true } : {}),
        ...(override ? { override_name_mismatch: true } : {}),
        ...(override || result.checked_number !== storedNumber ? { reason: reason.trim() } : {}),
      });
      if (!ok) {
        setError(fieldErrorMessage(payload?.fields) ?? apiErrorMessage(payload?.code, "تعذّر الحفظ. حاول مجددًا."));
        return;
      }
      if (payload?.changed === false) {
        setSaved("هذا هو الرقم المحفوظ والحالة لم تتغيّر، لا شيء ليُحفظ.");
        return;
      }
      setSaved(
        `حُفظ الرقم ${payload.checked_number} والحالة: ${licenseStatusLabel(payload.status)}.` +
          (payload.hebrew_name_changed
            ? " واعتُمدت كتابة السجل للاسم العبري؛ إن كان للطبيب ترخيص آخر فأعد فحصه."
            : ""),
      );
      setResult(null);
      setByName(null);
      router.refresh();
    } catch {
      setError("تعذّر الاتصال. تحقّق من الشبكة وحاول مجددًا.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-foreground/5"
      >
        بحث في السجل أو تصحيح الرقم
      </button>
    );
  }

  const registryName = result?.registry
    ? `${result.registry.firstName ?? ""} ${result.registry.familyName ?? ""}`.trim()
    : "";
  const ourName = result ? `${result.our_name.firstName ?? ""} ${result.our_name.familyName ?? ""}`.trim() : "";
  const adoptable = Boolean(result?.adoptable_name);
  const mismatch = result?.status === "name_mismatch";
  const changesNumber = Boolean(result) && result?.checked_number !== storedNumber;
  const canSave =
    Boolean(result) && (!mismatch || override) && (!(override || changesNumber) || reason.trim().length >= 3);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-background/60 p-3 text-sm">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`lic-${slot}`} className="font-medium">
          رقم الترخيص ({region === "IL" ? "إسرائيل" : "فلسطين"})
        </label>
        {region === "IL" && (
          <p className="text-xs text-muted">أدخله كما في سجل الوزارة، مثل 1-189371 أو 189371.</p>
        )}
        <div className="flex gap-2">
          <input
            id={`lic-${slot}`}
            dir="ltr"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className="w-40 rounded-md border border-line bg-surface px-3 py-1.5 text-base tabular-nums"
          />
          <button
            type="button"
            disabled={busy || !number.trim()}
            onClick={() => search()}
            className="rounded-md border border-line bg-surface px-3 py-1.5 hover:bg-foreground/5 disabled:opacity-50"
          >
            {busy ? "جارٍ البحث…" : "بحث في السجل"}
          </button>
          {region === "IL" && (
            <button
              type="button"
              disabled={busy}
              onClick={findByName}
              className="rounded-md border border-line bg-surface px-3 py-1.5 hover:bg-foreground/5 disabled:opacity-50"
            >
              بحث بالاسم
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              setResult(null);
              setNumber(storedNumber);
              setByName(null);
              setError(null);
            }}
            className="rounded-md border border-line bg-surface px-3 py-1.5 hover:bg-foreground/5 disabled:opacity-50"
          >
            إلغاء
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-danger">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-md border border-success-line bg-success-bg px-3 py-2 text-success">
          {saved}
        </p>
      )}

      {byName && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
          <p className="font-medium">أرقام في السجل بهذا الاسم</p>
          <p className="text-xs text-muted">
            اسم مطابق لا يثبت الهوية: تأكّد من الطبيب (اتصال أو واتساب) قبل اعتماد أي رقم.
          </p>
          {!byName.hasName ? (
            <p>لا يوجد اسم عبري محفوظ لهذا الطبيب، فلا يمكن البحث بالاسم.</p>
          ) : byName.candidates.length === 0 ? (
            <p>لا يوجد في السجل أحد بهذا الاسم العائلي.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {byName.candidates.map((c) => (
                <li key={c.licenseNumber} className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="tabular-nums">
                    {c.licenseNumber}
                  </span>
                  <span dir="ltr">
                    {c.firstName} {c.familyName}
                  </span>
                  {c.specialtyHe && <span dir="ltr" className="text-muted">{c.specialtyHe}</span>}
                  <span className="text-xs text-muted">
                    {c.kind === "exact" ? "اسم مطابق" : "نفس اسم العائلة فقط"}
                    {c.distance !== null && c.distance <= 2 ? ` · يختلف بـ ${c.distance} من الأرقام` : ""}
                  </span>
                  {c.heldBy && (
                    <span className="text-xs text-danger">مسجَّل لـ د. {c.heldBy.name}</span>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`فحص الرقم ${c.licenseNumber}`}
                    onClick={() => {
                      setNumber(c.licenseNumber);
                      search(c.licenseNumber);
                    }}
                    className="rounded-md border border-line bg-background px-2 py-1 text-xs hover:bg-foreground/5 disabled:opacity-50"
                  >
                    فحص هذا الرقم
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result && (
        <div className={`flex flex-col gap-2 rounded-lg border p-3 ${TONE_BOX[result.explanation.tone]}`}>
          <p className="font-medium">نتيجة البحث</p>
          <p>{result.explanation.headline}</p>
          {registryName && (
            <p>
              السجل يكتب الاسم: <span dir="ltr">{registryName}</span>
              {result.registry?.specialtyHe && (
                <>
                  {" · تخصص السجل: "}
                  <span dir="ltr">{result.registry.specialtyHe}</span>
                </>
              )}
            </p>
          )}
          {adoptable && (
            <p>
              المسجَّل لدينا: <span dir="ltr">{ourName}</span>
            </p>
          )}
          {result.source === "live" && <p className="text-xs text-muted">بحث مباشر في موقع الوزارة الآن.</p>}
          {result.checked_number !== number.trim() && (
            <p className="text-xs text-muted">
              الرقم الذي فُحص فعليًا: <span dir="ltr">{result.checked_number}</span>
            </p>
          )}
          {result.duplicate_of && (
            <p className="text-danger">
              تنبيه: هذا الرقم مسجَّل لـ د. {result.duplicate_of.name}. لا يمكن أن يحمل رقمًا واحدًا طبيبان.
            </p>
          )}

          <p>
            الحفظ سيضع الحالة:{" "}
            <span className={toneChip(result.explanation.tone)}>{licenseStatusLabel(result.column_status)}</span>
          </p>

          {changesNumber && !mismatch && (
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={300}
              aria-label="سبب تغيير الرقم"
              placeholder="سبب تغيير الرقم، مثل: كلّمت الطبيب وأكّد الرقم الصحيح."
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base"
            />
          )}

          {mismatch && (
            <div className="flex flex-col gap-2 rounded-md border border-danger-line bg-surface p-2">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={override}
                  onChange={(e) => setOverride(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-foreground"
                />
                <span>أتحمّل مسؤولية الحفظ رغم اختلاف الاسم</span>
              </label>
              {override && (
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  maxLength={300}
                  aria-label="سبب الحفظ"
                  placeholder="مثال: راجعت صورة الترخيص مع الطبيب."
                  className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base"
                />
              )}
            </div>
          )}

          {/* The one action that settles a partial match. The number is the
              registry's and only the spelling of the name differs, so taking
              the registry's spelling makes the match exact — which is the
              only way "موثّق" can be true rather than merely asserted. */}
          {adoptable && (
            <div className="flex flex-col gap-1.5 rounded-md border border-success-line bg-surface p-2">
              <p>
                اعتماد كتابة السجل يستبدل الاسم العبري المسجَّل لدينا بـ{" "}
                <span dir="ltr">{registryName}</span>، فتصبح الحالة{" "}
                <span className={toneChip("success")}>{licenseStatusLabel("verified")}</span>.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => save(true)}
                className="w-fit rounded-md border border-success-line bg-success-bg px-3 py-1.5 text-success hover:opacity-90 disabled:opacity-40"
              >
                اعتماد كتابة السجل وحفظها
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !canSave}
              onClick={() => save()}
              className="rounded-md border border-success-line bg-success-bg px-3 py-1.5 text-success hover:opacity-90 disabled:opacity-40"
            >
              {result.same_as_stored && result.column_status === result.stored_status
                ? "لا شيء ليُحفظ"
                : adoptable
                  ? "حفظ كما هو"
                  : "حفظ هذا الرقم"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setResult(null)}
              className="rounded-md border border-line bg-surface px-3 py-1.5 hover:bg-foreground/5 disabled:opacity-50"
            >
              تجاهل النتيجة
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
