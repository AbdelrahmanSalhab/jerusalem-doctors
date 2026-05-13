"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface Row {
  id: string;
  arabic_first_name: string;
  arabic_family_name: string;
  phone_e164: string;
  license_number: string;
  license_verification_status: string | null;
  is_admin_approved: boolean;
  is_active: boolean;
  user_chose_visible: boolean;
  created_at: string;
}

const statusLabels: Record<string, string> = {
  verified: "موثّق",
  soft_match: "تطابق جزئي",
  not_found: "غير موجود في السجل",
  name_mismatch_overridden: "تم التغاضي يدويًا",
};

export function AdminDoctorsTable({
  rows,
  currentStatus,
  currentQ,
}: {
  rows: Row[];
  currentStatus: string;
  currentQ: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(currentQ);
  const [pending, startTransition] = useTransition();

  const navigate = (
    next: { status?: string; q?: string },
  ) => {
    const params = new URLSearchParams();
    const status = next.status ?? currentStatus;
    if (status !== "pending") params.set("status", status);
    const search = next.q ?? q;
    if (search) params.set("q", search);
    startTransition(() => router.push(`/admin?${params}`));
  };

  const toggle = async (id: string, field: "is_admin_approved" | "is_active", value: boolean) => {
    const res = await fetch(`/api/admin/doctors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (res.ok) startTransition(() => router.refresh());
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="inline-flex overflow-hidden rounded-md border border-foreground/20">
          {(["pending", "approved", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => navigate({ status: s })}
              className={
                "px-3 py-1.5 text-sm border-r border-foreground/20 last:border-r-0 " +
                (currentStatus === s
                  ? "bg-foreground text-background"
                  : "hover:bg-foreground/5")
              }
            >
              {s === "pending" ? "قيد المراجعة" : s === "approved" ? "مفعّلون" : "الكل"}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigate({ q });
          }}
          className="flex flex-1 gap-2"
        >
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث بالاسم، الترخيص، أو الهاتف"
            className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-md border border-foreground/20 px-3 py-2 text-sm hover:bg-foreground/5"
          >
            بحث
          </button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-lg border border-foreground/15">
        <table className="w-full text-base">
          <thead className="bg-foreground/5">
            <tr>
              <th className="p-3 text-start">الاسم</th>
              <th className="p-3 text-center">الهاتف</th>
              <th className="p-3 text-center">الترخيص</th>
              <th className="p-3 text-center">حالة التحقق</th>
              <th className="p-3 text-center">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-foreground/65">
                  لا توجد نتائج.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-foreground/10">
                <td className="p-3">
                  <div className="font-medium">
                    {r.arabic_first_name} {r.arabic_family_name}
                  </div>
                </td>
                <td className="p-3 text-center" dir="ltr">
                  {r.phone_e164}
                </td>
                <td className="p-3 text-center" dir="ltr">
                  {r.license_number}
                </td>
                <td className="p-3 text-center">
                  <span
                    className={
                      "inline-block rounded-full px-2.5 py-0.5 text-sm " +
                      (r.license_verification_status === "verified"
                        ? "bg-green-100 text-green-800"
                        : "bg-amber-100 text-amber-800")
                    }
                  >
                    {statusLabels[r.license_verification_status ?? ""] ??
                      "غير محدد"}
                  </span>
                </td>
                <td className="p-3 text-center">
                  <div className="flex flex-wrap justify-center gap-1.5">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        toggle(r.id, "is_admin_approved", !r.is_admin_approved)
                      }
                      className={
                        "rounded border px-2.5 py-1 text-sm " +
                        (r.is_admin_approved
                          ? "border-foreground/20 hover:bg-foreground/5"
                          : "border-green-500 bg-green-50 text-green-800 hover:bg-green-100")
                      }
                    >
                      {r.is_admin_approved ? "إلغاء التفعيل" : "تفعيل"}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => toggle(r.id, "is_active", !r.is_active)}
                      className={
                        "rounded border px-2.5 py-1 text-sm " +
                        (r.is_active
                          ? "border-red-400 text-red-700 hover:bg-red-50"
                          : "border-foreground/20 hover:bg-foreground/5")
                      }
                    >
                      {r.is_active ? "تعليق" : "إعادة التفعيل"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
