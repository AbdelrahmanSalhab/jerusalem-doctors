// Phone, licenses and email: the first section of the signup form.

import { Field, OPTION_CARD, OPTION_INPUT } from "@/components/FormField";
import {
  cleanLicense,
  cleanPhone,
  type FormState,
  type LicenseRegion,
  OTHER_REGION,
  type UpdateField,
} from "@/lib/signup/formState";
import { Section } from "./SignupFields";

export function LicenseSection({
  form,
  update,
  setRegion,
  fieldError,
}: {
  form: FormState;
  update: UpdateField;
  setRegion: (region: LicenseRegion) => void;
  fieldError: (k: string) => string | undefined;
}) {
  return (
    <Section title="معلومات الاتصال والترخيص">
      <Field label="رقم الهاتف" htmlFor="phone" required error={fieldError("phone")}>
        <input
          id="phone"
          type="tel"
          required
          dir="ltr"
          autoComplete="tel"
          inputMode="tel"
          pattern="[0-9+\-\s\(\)]*"
          className="input"
          value={form.phone}
          onChange={(e) => update("phone", cleanPhone(e.target.value))}
          placeholder="05XXXXXXXX"
        />
      </Field>

      <Field label="جهة الترخيص" required>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={OPTION_CARD}>
            <input
              type="radio"
              name="license_region"
              className={OPTION_INPUT}
              checked={form.license_region === "IL"}
              onChange={() => setRegion("IL")}
            />
            <span>ترخيص إسرائيلي (وزارة الصحة)</span>
          </label>
          <label className={OPTION_CARD}>
            <input
              type="radio"
              name="license_region"
              className={OPTION_INPUT}
              checked={form.license_region === "PS"}
              onChange={() => setRegion("PS")}
            />
            <span>ترخيص فلسطيني (نقابة الأطباء / وزارة الصحة)</span>
          </label>
        </div>
        {form.license_region === "PS" && (
          <p className="mt-2 text-sm text-foreground/65">
            لا يوجد سجل إلكتروني يمكننا مطابقته آليًا لهذا النوع من
            التراخيص حاليًا، لذا ستتم مراجعة طلبك يدويًا من قبل الإدارة قبل
            التفعيل.
          </p>
        )}
      </Field>

      <Field
        label="رقم الترخيص"
        htmlFor="license_number"
        required
        error={fieldError("license_number")}
      >
        <input
          id="license_number"
          required
          dir="ltr"
          inputMode={form.license_region === "IL" ? "numeric" : "text"}
          // Escaped for the v flag browsers now compile patterns with.
          pattern={form.license_region === "IL" ? "[0-9\\-]*" : undefined}
          className="input"
          placeholder={form.license_region === "IL" ? "189371" : undefined}
          value={form.license_number}
          onChange={(e) =>
            update("license_number", cleanLicense(form.license_region, e.target.value))
          }
        />
      </Field>

      <Field
        label="ترخيص إضافي"
        htmlFor="secondary_license_number"
        required={form.has_secondary_license}
      >
        <label className={OPTION_CARD}>
          <input
            type="checkbox"
            className={OPTION_INPUT}
            checked={form.has_secondary_license}
            onChange={(e) => update("has_secondary_license", e.target.checked)}
          />
          <span>
            لديّ أيضًا ترخيص من الجهة الأخرى ({" "}
            {OTHER_REGION[form.license_region] === "IL" ? "إسرائيلي" : "فلسطيني"} )
          </span>
        </label>
        {form.has_secondary_license && (
          <input
            id="secondary_license_number"
            required
            dir="ltr"
            className="input mt-2"
            inputMode={
              form.secondary_license_region === "IL" ? "numeric" : "text"
            }
            value={form.secondary_license_number}
            onChange={(e) =>
              update(
                "secondary_license_number",
                cleanLicense(form.secondary_license_region, e.target.value),
              )
            }
            placeholder={
              form.secondary_license_region === "IL"
                ? "رقم الترخيص الإسرائيلي، مثل 189371"
                : "رقم الترخيص الفلسطيني"
            }
          />
        )}
        {fieldError("secondary_license_number") && (
          <p className="mt-1 text-sm text-danger">
            {fieldError("secondary_license_number")}
          </p>
        )}
      </Field>

      <Field label="البريد الإلكتروني" htmlFor="email" required error={fieldError("email")}>
        <input
          id="email"
          type="email"
          required
          dir="ltr"
          autoComplete="email"
          className="input"
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
        />
      </Field>
    </Section>
  );
}
