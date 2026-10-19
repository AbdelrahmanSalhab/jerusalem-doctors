// Label + control + error, shared by the signup and profile forms.
//
// `required` only draws the red asterisk; the control itself still carries
// the native `required` attribute, which is what screen readers announce,
// so the asterisk is aria-hidden rather than read out twice.

/** A choice drawn as a full-width card: easy to hit with a thumb, and the
 *  picked one stands out. Put it on the <label> wrapping a radio or checkbox. */
export const OPTION_CARD =
  "flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface p-3 transition-colors " +
  "hover:border-foreground/40 has-[:checked]:border-foreground has-[:checked]:bg-foreground/5";

/** The radio or checkbox inside an OPTION_CARD. */
export const OPTION_INPUT = "mt-0.5 h-5 w-5 shrink-0 accent-foreground";

export function Field({
  label,
  htmlFor,
  required,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-base font-medium">
        {label}
        {required && <RequiredMark />}
      </label>
      {children}
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

export function RequiredMark() {
  return (
    <span aria-hidden="true" className="ms-1 text-danger">
      *
    </span>
  );
}

/** Shown on the card as a badge; also what lets an admin feature the
 *  doctor in the dashboard's new-graduates section. */
export function SeekingWorkCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={OPTION_CARD}>
      <input
        type="checkbox"
        className={OPTION_INPUT}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        أبحث عن فرصة عمل
        <span className="block text-sm text-muted">
          تظهر عبارة &quot;يبحث عن فرصة عمل&quot; على بطاقتك، ويمكنك إلغاؤها في أي وقت من ملفك.
        </span>
      </span>
    </label>
  );
}
