// Label + control + error, shared by the signup and profile forms.
//
// `required` only draws the red asterisk; the control itself still carries
// the native `required` attribute, which is what screen readers announce,
// so the asterisk is aria-hidden rather than read out twice.

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
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function RequiredMark() {
  return (
    <span aria-hidden="true" className="ms-1 text-red-600">
      *
    </span>
  );
}
