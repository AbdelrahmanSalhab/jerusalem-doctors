"use client";

// «أبلغ عن هذا الملف» at the foot of a doctor's card: a short reason, sent to
// the admins (POST /api/reports). Signed-in doctors only, which is everyone
// who sees a card; not on the viewer's own card.

import { useState } from "react";
import { useViewer } from "@/components/ViewerContext";

export function ReportProfileButton({ doctorId, name }: { doctorId: string; name: string }) {
  const viewer = useViewer();
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  if (viewer?.id === doctorId) return null;
  if (state === "sent") {
    return (
      <p role="status" className="text-xs text-muted">
        وصل بلاغك إلى الإدارة. شكرًا.
      </p>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center self-start text-xs text-muted underline hover:text-foreground pointer-coarse:min-h-11">
        أبلغ عن هذا الملف
      </button>
    );
  }

  const send = async () => {
    setState("sending");
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_doctor_id: doctorId, details }),
    }).catch(() => null);
    setState(res?.ok ? "sent" : "error");
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-3 text-sm">
      <label htmlFor={`report-${doctorId}`} className="font-medium">
        ما المشكلة في ملف د. {name}؟
      </label>
      <textarea
        id={`report-${doctorId}`}
        rows={3}
        maxLength={1000}
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        placeholder="مثلًا: هذا ليس الطبيب الحقيقي، أو رقم الترخيص رقمي أنا."
        className="rounded-md border border-line bg-background px-3 py-2 text-base"
      />
      {state === "error" && (
        <p role="alert" className="text-danger">
          تعذّر الإرسال. اكتب 5 أحرف على الأقل وحاول مجددًا.
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={send}
          disabled={state === "sending" || details.trim().length < 5}
          className="rounded-md bg-primary px-3 py-1.5 text-primary-fg disabled:opacity-50"
        >
          إرسال للإدارة
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line px-3 py-1.5">
          إلغاء
        </button>
      </div>
    </div>
  );
}
