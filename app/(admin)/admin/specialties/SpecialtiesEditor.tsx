"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface Row {
  id: string;
  name_ar: string;
  name_he: string | null;
  name_en: string | null;
  sort_order: number | null;
  is_active: boolean;
}

export function SpecialtiesEditor({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const update = async (id: string, patch: Partial<Row>) => {
    const res = await fetch(`/api/admin/specialties/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) startTransition(() => router.refresh());
  };

  return (
    <div className="space-y-4">
      <NewSpecialtyRow />

      <div className="overflow-x-auto rounded-lg border border-foreground/15">
        <table className="w-full text-sm">
          <thead className="bg-foreground/5">
            <tr>
              <th className="p-3 text-start">الترتيب</th>
              <th className="p-3 text-start">العربية</th>
              <th className="p-3 text-start">العبرية</th>
              <th className="p-3 text-start">الإنجليزية</th>
              <th className="p-3 text-start">حالة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-foreground/10">
                <td className="p-3" dir="ltr">
                  <input
                    type="number"
                    defaultValue={r.sort_order ?? 0}
                    onBlur={(e) =>
                      update(r.id, { sort_order: Number(e.target.value) })
                    }
                    className="w-16 rounded border border-foreground/15 bg-transparent px-2 py-1"
                  />
                </td>
                <td className="p-3">
                  <input
                    defaultValue={r.name_ar}
                    onBlur={(e) =>
                      update(r.id, { name_ar: e.target.value })
                    }
                    className="rounded border border-foreground/15 bg-transparent px-2 py-1"
                  />
                </td>
                <td className="p-3" dir="auto">
                  <input
                    defaultValue={r.name_he ?? ""}
                    onBlur={(e) =>
                      update(r.id, { name_he: e.target.value })
                    }
                    className="rounded border border-foreground/15 bg-transparent px-2 py-1"
                  />
                </td>
                <td className="p-3" dir="ltr">
                  <input
                    defaultValue={r.name_en ?? ""}
                    onBlur={(e) =>
                      update(r.id, { name_en: e.target.value })
                    }
                    className="rounded border border-foreground/15 bg-transparent px-2 py-1"
                  />
                </td>
                <td className="p-3">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => update(r.id, { is_active: !r.is_active })}
                    className={
                      "rounded border px-2 py-1 text-xs " +
                      (r.is_active
                        ? "border-foreground/20 hover:bg-foreground/5"
                        : "border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100")
                    }
                  >
                    {r.is_active ? "نشط" : "معطّل"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewSpecialtyRow() {
  const router = useRouter();
  const [nameAr, setNameAr] = useState("");
  const [nameHe, setNameHe] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameAr.trim()) return;
    const res = await fetch("/api/admin/specialties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name_ar: nameAr.trim(),
        name_he: nameHe.trim() || null,
        name_en: nameEn.trim() || null,
      }),
    });
    if (res.ok) {
      setNameAr("");
      setNameHe("");
      setNameEn("");
      startTransition(() => router.refresh());
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-foreground/15 p-3"
    >
      <label className="text-sm font-medium">إضافة تخصص جديد:</label>
      <input
        placeholder="بالعربية"
        value={nameAr}
        onChange={(e) => setNameAr(e.target.value)}
        className="rounded border border-foreground/15 bg-transparent px-2 py-1 text-sm"
        required
      />
      <input
        placeholder="بالعبرية"
        dir="auto"
        value={nameHe}
        onChange={(e) => setNameHe(e.target.value)}
        className="rounded border border-foreground/15 bg-transparent px-2 py-1 text-sm"
      />
      <input
        placeholder="English"
        dir="ltr"
        value={nameEn}
        onChange={(e) => setNameEn(e.target.value)}
        className="rounded border border-foreground/15 bg-transparent px-2 py-1 text-sm"
      />
      <button
        type="submit"
        disabled={pending || !nameAr.trim()}
        className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50"
      >
        إضافة
      </button>
    </form>
  );
}
