"use client";

// A colleague's number, WhatsApp and email, behind a tap (#16). The card
// carries only that there is something to show; the details come from
// POST /api/doctors/[id]/contact, which counts the doctor against the day's
// budget. Once shown they stay for as long as the card does.

import { useState } from "react";
import { ContactButtons } from "@/components/ContactButtons";
import type { ContactDetails, SearchHit } from "@/lib/directory";
import { clinicTelHref } from "@/lib/workplace";

type Doctor = Pick<
  SearchHit,
  "id" | "arabic_first_name" | "arabic_family_name" | "has_contact" | "specialties" | "workplaces"
>;

type State = { kind: "hidden" } | { kind: "loading" } | { kind: "shown"; contact: ContactDetails } | { kind: "refused"; message: string };

const LIMIT_MESSAGE = "بلغت حد اليوم من إظهار أرقام الزملاء. يتجدّد غدًا، وإن احتجت رقمًا الآن فراسل الإدارة.";
const FAILED_MESSAGE = "تعذّر إظهار البيانات. حاول مرة أخرى.";

async function fetchContact(id: string): Promise<State> {
  try {
    const res = await fetch(`/api/doctors/${id}/contact`, { method: "POST" });
    if (res.ok) return { kind: "shown", contact: (await res.json()) as ContactDetails };
    return { kind: "refused", message: res.status === 429 ? LIMIT_MESSAGE : FAILED_MESSAGE };
  } catch {
    return { kind: "refused", message: FAILED_MESSAGE };
  }
}

export function RevealContact({ doctor, compact = false }: { doctor: Doctor; compact?: boolean }) {
  const [state, setState] = useState<State>({ kind: "hidden" });
  if (!doctor.has_contact) return null;

  if (state.kind !== "shown") {
    return (
      <div className={compact ? "flex shrink-0 flex-col items-start gap-1" : "flex flex-col items-start gap-1"}>
        <button
          type="button"
          disabled={state.kind === "loading"}
          onClick={() => {
            setState({ kind: "loading" });
            void fetchContact(doctor.id).then(setState);
          }}
          className={`inline-flex items-center justify-center rounded-md border border-line bg-surface font-medium hover:bg-foreground/5 disabled:opacity-60 ${compact ? "px-3 py-2 text-sm" : "px-4 py-2.5"}`}
        >
          {state.kind === "loading" ? "جارٍ الإظهار…" : "إظهار الهاتف والبريد"}
        </button>
        {state.kind === "refused" && (
          <p role="alert" className="max-w-xs text-sm text-danger">
            {state.message}
          </p>
        )}
      </div>
    );
  }

  const { contact } = state;
  const full = { ...doctor, ...contact };
  return (
    <div className="flex flex-col gap-2">
      {(contact.phone_display || contact.email) && (
        <dl className="flex flex-col gap-1 text-sm">
          {contact.phone_display && (
            <div className="flex items-baseline gap-2">
              <dt className="text-foreground/65">الهاتف:</dt>
              <dd dir="ltr">
                <a href={clinicTelHref(contact.phone_display) ?? undefined} className="hover:underline">
                  {contact.phone_display}
                </a>
              </dd>
            </div>
          )}
          {contact.email && (
            <div className="flex items-baseline gap-2">
              <dt className="text-foreground/65">البريد:</dt>
              <dd dir="ltr" className="break-all">
                {contact.email}
              </dd>
            </div>
          )}
        </dl>
      )}
      <ContactButtons doctor={full} compact={compact} />
    </div>
  );
}
