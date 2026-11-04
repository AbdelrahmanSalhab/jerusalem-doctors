"use client";

// «مراجعة الهوية»: an accepted doctor whom no admin has yet satisfied
// themselves is who they say (#16). The doctors accepted at signup on a
// registry match alone are cleared here, one at a time, with how the admin knew
// and a few words, kept in the activity log. Shows when it was done once it has
// been. Not shown for staff accounts, which are not doctors.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApprovalReasonPrompt } from "./ApprovalReasonPrompt";
import type { ApprovalMethod } from "@/lib/admin/approvalMethods";
import { apiErrorMessage } from "@/lib/client/apiError";
import { explainDate } from "@/lib/moh/explain";

export function IdentityReview({
  doctorId,
  name,
  reviewedAt,
}: {
  doctorId: string;
  name: string;
  reviewedAt: string | null;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (reviewedAt) {
    return <p className="text-xs text-muted">روجعت هوية هذا الطبيب في {explainDate(reviewedAt)}.</p>;
  }

  const confirm = async (reason: string, method: ApprovalMethod) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/doctors/${doctorId}/identity-reviewed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approval_reason: reason, approval_method: method }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(apiErrorMessage(payload?.code, "تعذّر الحفظ. حاول مرة أخرى."));
        setBusy(false);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("تعذّر الاتصال. حاول مرة أخرى.");
      setBusy(false);
      return false;
    }
  };

  if (!asking) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-warn-line bg-warn-bg p-3 text-sm">
        <p className="font-semibold">لم تُراجَع هوية هذا الطبيب</p>
        <p className="text-foreground/80">
          قُبل قبل أن يُسأل المشرف كيف تأكّد منه، فاسمه ورقمه مطابقان للسجل لكن أحدًا لم يتأكد أنه هو.
        </p>
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="w-fit rounded-md border border-line bg-surface px-3 py-1.5 hover:bg-foreground/5"
        >
          مراجعة الهوية
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ApprovalReasonPrompt
        name={name}
        status={null}
        region={null}
        busy={busy}
        heading="كيف تأكّدت أنه هو؟"
        submitLabel="تمت مراجعة الهوية"
        lead={`د. ${name} مقبول، واسمه ورقمه يطابقان سجل الوزارة، لكن هذه معلومات علنية يستطيع أي شخص كتابتها.`}
        onCancel={() => setAsking(false)}
        onConfirm={confirm}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
