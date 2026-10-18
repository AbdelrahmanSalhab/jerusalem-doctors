// Layout pieces the signup form's sections share.

import { Field, RequiredMark } from "@/components/FormField";

export function Section({
  title,
  required,
  children,
}: {
  title: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-foreground/15 p-5 space-y-4">
      <h2 className="border-b border-foreground/10 pb-2 text-lg font-bold">
        {title}
        {required && <RequiredMark />}
      </h2>
      {children}
    </section>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  required,
  error,
  dir,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  error?: string;
  dir?: "auto";
  placeholder?: string;
}) {
  return (
    <Field label={label} htmlFor={id} required={required} error={error}>
      <input
        id={id}
        required={required}
        dir={dir}
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
