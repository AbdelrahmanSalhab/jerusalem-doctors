// Arabic and Hebrew names, plus the MoH name-mismatch override.

import type { FormState, UpdateField } from "@/lib/signup/formState";
import { Section, TextField } from "./SignupFields";

export function NameSection({
  form,
  update,
  hebrewRequired,
  fieldError,
  registryName,
  overrideMismatch,
  setOverrideMismatch,
}: {
  form: FormState;
  update: UpdateField;
  hebrewRequired: boolean;
  fieldError: (k: string) => string | undefined;
  registryName: { first?: string; family?: string } | null;
  overrideMismatch: boolean;
  setOverrideMismatch: (v: boolean) => void;
}) {
  return (
    <Section title="الاسم">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          id="arabic_first_name"
          label="الاسم بالعربية"
          required
          value={form.arabic_first_name}
          onChange={(v) => update("arabic_first_name", v)}
          error={fieldError("arabic_first_name")}
        />
        <TextField
          id="arabic_family_name"
          label="اسم العائلة بالعربية"
          required
          value={form.arabic_family_name}
          onChange={(v) => update("arabic_family_name", v)}
          error={fieldError("arabic_family_name")}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          id="hebrew_first_name"
          label={hebrewRequired ? "الاسم بالعبرية" : "الاسم بالعبرية (اختياري)"}
          required={hebrewRequired}
          dir="auto"
          value={form.hebrew_first_name}
          onChange={(v) => update("hebrew_first_name", v)}
          error={fieldError("hebrew_first_name")}
        />
        <TextField
          id="hebrew_family_name"
          label={
            hebrewRequired ? "اسم العائلة بالعبرية" : "اسم العائلة بالعبرية (اختياري)"
          }
          required={hebrewRequired}
          dir="auto"
          value={form.hebrew_family_name}
          onChange={(v) => update("hebrew_family_name", v)}
          error={fieldError("hebrew_family_name")}
        />
      </div>
      {hebrewRequired && (
        <p className="text-sm text-foreground/65">
          نستخدم الاسم بالعبرية فقط لمطابقة رقم الترخيص مع سجل وزارة الصحة
          الإسرائيلية.
        </p>
      )}

      {fieldError("hebrew_full_name") && (
        <p className="text-sm text-red-600">{fieldError("hebrew_full_name")}</p>
      )}

      {registryName && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-base">
          <p className="mb-2">
            الاسم في سجل وزارة الصحة لرقم الترخيص هذا هو:{" "}
            <strong dir="auto">
              {registryName.first} {registryName.family}
            </strong>
            .
          </p>
          <p className="mb-2">
            إذا كنت متأكدًا أنك أنت، يمكنك المتابعة وسيتم مراجعة طلبك من قبل
            الإدارة قبل تفعيل الحساب.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={overrideMismatch}
              onChange={(e) => setOverrideMismatch(e.target.checked)}
            />
            <span>أؤكد أن هذا حسابي وأطلب المراجعة اليدوية</span>
          </label>
        </div>
      )}
    </Section>
  );
}
