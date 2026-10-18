// Layout pieces the profile form's sections share.

import { useState } from "react";

export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-foreground/15 p-5">
      <div className="flex items-center justify-between gap-2 border-b border-foreground/10 pb-2">
        <h2 className="text-lg font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-foreground/20 px-3 py-1 text-sm hover:bg-foreground/5"
    >
      تعديل
    </button>
  );
}

export function ReadOnlyView({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-md border border-foreground/15 bg-foreground/5 p-4">
      {children}
    </div>
  );
}

export function Locked({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-foreground/65">
        {label}
      </label>
      <div className="rounded-md border border-dashed border-foreground/20 bg-foreground/5 px-3 py-2 text-foreground/80">
        {children}
      </div>
    </div>
  );
}

export function LockableField({
  label,
  value,
  onChange,
  type = "text",
  dir,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  dir?: "ltr" | "rtl" | "auto";
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div>
      <label className="mb-1.5 block text-base font-medium">{label}</label>
      {editing ? (
        <input
          type={type}
          dir={dir}
          required
          autoFocus
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="flex items-stretch gap-2">
          <div
            className="flex flex-1 items-center rounded-md border border-foreground/15 bg-foreground/5 px-3 py-2.5 text-foreground/85"
            dir={dir}
          >
            {value || (
              <span className="text-foreground/40">غير محدد</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-foreground/20 px-3 text-sm hover:bg-foreground/5"
          >
            تعديل
          </button>
        </div>
      )}
    </div>
  );
}
