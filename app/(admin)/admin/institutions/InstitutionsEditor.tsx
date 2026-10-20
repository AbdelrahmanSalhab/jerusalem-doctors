"use client";

// The institutions list: add, edit, delete, and claim the workplace names
// no institution matches yet (each as a new spelling of an existing one, or
// as a new institution).

import { countOf, DOCTORS } from "@/lib/arabicCount";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InputStyles } from "@/components/InputStyles";
import { apiErrorMessage, fieldErrorMessage } from "@/lib/client/apiError";
import {
  type Institution,
  INSTITUTION_KIND_LABEL,
  INSTITUTION_KINDS,
  type InstitutionKind,
  type UnmatchedName,
} from "@/lib/institutions";

/** Section headings: hospitals, then the health funds together, then
 *  clinic networks. */
const KIND_GROUP: Record<InstitutionKind, string> = {
  hospital: "مستشفيات",
  hmo: "صناديق المرضى",
  clinic_network: "شبكات عيادات",
};

const splitAliases = (s: string) =>
  s.split(/[,،\n]/).map((x) => x.trim()).filter((x) => x.length >= 2);

export type DoctorLink = { id: string; name: string };

/** The panel opens over this tab, so closing it comes back here. */
const panelHref = (id: string) => `/admin/institutions?doctor=${id}`;

/** Doctor names as links into their panel. Inline while the list is short,
 *  folded away once one bad spelling has gathered a crowd. */
function DoctorLinks({ doctors }: { doctors: DoctorLink[] }) {
  if (doctors.length === 0) return null;
  const link = (d: DoctorLink) => (
    <Link href={panelHref(d.id)} className="underline underline-offset-2 hover:no-underline">
      {d.name}
    </Link>
  );
  if (doctors.length <= 3) {
    return (
      <span className="flex flex-wrap gap-x-2 text-xs">
        {doctors.map((d, i) => (
          <span key={d.id}>
            {link(d)}
            {i < doctors.length - 1 && "،"}
          </span>
        ))}
      </span>
    );
  }
  return (
    <details className="text-xs">
      <summary className="cursor-pointer tabular-nums">{countOf(doctors.length, DOCTORS)}</summary>
      <ul className="mt-1 list-disc ps-5">
        {doctors.map((d) => (
          <li key={d.id}>{link(d)}</li>
        ))}
      </ul>
    </details>
  );
}

export function InstitutionsEditor({
  institutions,
  doctors,
  unmatched,
}: {
  institutions: Institution[];
  doctors: Record<string, DoctorLink[]>;
  unmatched: UnmatchedName[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // What the last action did, shown above everything: green on success, red
  // on failure, so a press never passes without an answer.
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState({ name_ar: "", name_he: "", kind: "hospital" as InstitutionKind, aliases: "" });

  const send = async (url: string, method: string, body: unknown, success: string) => {
    setNotice(null);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    const b = await res?.json().catch(() => null);
    if (!res?.ok) {
      setNotice({ ok: false, text: fieldErrorMessage(b?.fields) ?? apiErrorMessage(b?.code, "تعذّر الحفظ. حاول مجددًا.") });
      return false;
    }
    setNotice(
      b?.still_unlinked
        ? { ok: false, text: "حُفظت طريقة الكتابة، لكن الاسم ما زال غير مربوط. تأكد من اختيار المؤسسة الصحيحة، أو أبلغ المطوّر." }
        : { ok: true, text: success },
    );
    startTransition(() => router.refresh());
    return true;
  };

  const nameOf = (id: string) => institutions.find((i) => i.id === id)?.name_ar ?? "";

  const add = async () => {
    const ok = await send(
      "/api/admin/institutions",
      "POST",
      {
        name_ar: draft.name_ar,
        name_he: draft.name_he || null,
        kind: draft.kind,
        aliases: splitAliases(draft.aliases),
      },
      `✓ أُضيفت «${draft.name_ar.trim()}» وربطت الأسماء المطابقة.`,
    );
    if (ok) setDraft({ name_ar: "", name_he: "", kind: "hospital", aliases: "" });
  };

  return (
    <div className="flex flex-col gap-8">
      <InputStyles />
      {notice && (
        <p
          role={notice.ok ? "status" : "alert"}
          className={
            "sticky top-2 z-10 rounded border p-3 text-sm shadow-sm " +
            (notice.ok ? "border-success-line bg-success-bg text-success" : "border-danger-line bg-danger-bg text-danger")
          }
        >
          {notice.text}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          أسماء غير مربوطة <span className="tabular-nums text-muted">({unmatched.length})</span>
        </h2>
        {unmatched.length === 0 ? (
          <p className="text-sm text-muted">كل المستشفيات وصناديق المرضى مربوطة.</p>
        ) : (
          <ul className="divide-y divide-foreground/10 rounded-lg border border-warn-line bg-warn-bg text-warn">
            {unmatched.map((u) => (
              <UnmatchedRow
                key={u.name}
                item={u}
                institutions={institutions}
                disabled={pending}
                onClaim={(id) =>
                  send(`/api/admin/institutions/${id}`, "PATCH", { add_alias: u.name }, `✓ رُبط «${u.name}» بـ«${nameOf(id)}».`)
                }
                onNew={() => setDraft({ name_ar: u.name, name_he: "", kind: "hospital", aliases: "" })}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">إضافة مؤسسة</h2>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input id="new-name-ar" className="input" aria-label="الاسم بالعربية" placeholder="الاسم بالعربية" value={draft.name_ar}
            onChange={(e) => setDraft({ ...draft, name_ar: e.target.value })} />
          <input id="new-name-he" className="input" dir="rtl" aria-label="الاسم بالعبرية" placeholder="الاسم بالعبرية (اختياري)" value={draft.name_he}
            onChange={(e) => setDraft({ ...draft, name_he: e.target.value })} />
          <select id="new-kind" className="input" aria-label="نوع المؤسسة" value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as InstitutionKind })}>
            {INSTITUTION_KINDS.map((k) => (
              <option key={k} value={k}>{INSTITUTION_KIND_LABEL[k]}</option>
            ))}
          </select>
        </div>
        <textarea id="new-aliases" className="input min-h-16" placeholder="طرق كتابة أخرى، مفصولة بفاصلة"
          value={draft.aliases} onChange={(e) => setDraft({ ...draft, aliases: e.target.value })} />
        <button type="button" disabled={pending || draft.name_ar.trim().length < 2} onClick={add}
          className="self-start rounded-md bg-primary px-4 py-2 text-primary-fg disabled:opacity-50">
          إضافة
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">القائمة <span className="tabular-nums text-muted">({institutions.length})</span></h2>
        {INSTITUTION_KINDS.map((kind) => {
          const group = institutions.filter((i) => i.kind === kind);
          if (group.length === 0) return null;
          return (
            <div key={kind} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted">{KIND_GROUP[kind]}</h3>
              <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                {group.map((i) => (
                  <InstitutionRow
                    key={i.id}
                    institution={i}
                    doctors={doctors[i.id] ?? []}
                    disabled={pending}
                    onSave={(patch) => send(`/api/admin/institutions/${i.id}`, "PATCH", patch, `✓ حُفظت «${i.name_ar}».`)}
                    onDelete={() => {
                      if (window.confirm(`حذف «${i.name_ar}» من القائمة؟ أماكن العمل المرتبطة بها تبقى كما كتبها الأطباء.`)) {
                        void send(`/api/admin/institutions/${i.id}`, "DELETE", undefined, `✓ حُذفت «${i.name_ar}» من القائمة.`);
                      }
                    }}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function UnmatchedRow({
  item,
  institutions,
  disabled,
  onClaim,
  onNew,
}: {
  item: UnmatchedName;
  institutions: Institution[];
  disabled: boolean;
  onClaim: (id: string) => void;
  onNew: () => void;
}) {
  const [target, setTarget] = useState("");
  return (
    <li className="flex flex-wrap items-center gap-2 p-3 text-sm">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span>
          <span className="font-medium">{item.name}</span>{" "}
          <span className="tabular-nums text-warn">({item.count})</span>
        </span>
        <DoctorLinks doctors={item.doctors} />
      </span>
      <select
        className="max-w-full rounded-md border border-warn-line bg-transparent px-2 py-1.5"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        aria-label={`ربط «${item.name}» بمؤسسة`}>
        <option value="">اختر مؤسسة</option>
        {INSTITUTION_KINDS.map((kind) => (
          <optgroup key={kind} label={KIND_GROUP[kind]}>
            {institutions.filter((i) => i.kind === kind).map((i) => (
              <option key={i.id} value={i.id}>{i.name_ar}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <button type="button" disabled={disabled || !target} onClick={() => onClaim(target)}
        className="rounded border border-warn-line px-3 py-1 disabled:opacity-50">
        ربط كطريقة كتابة
      </button>
      <button type="button" disabled={disabled} onClick={onNew} className="rounded px-3 py-1 underline">
        مؤسسة جديدة
      </button>
    </li>
  );
}

function InstitutionRow({
  institution,
  doctors,
  disabled,
  onSave,
  onDelete,
}: {
  institution: Institution;
  doctors: DoctorLink[];
  disabled: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name_ar: institution.name_ar,
    name_he: institution.name_he ?? "",
    kind: institution.kind,
    aliases: institution.aliases.join("، "),
  });

  if (!editing) {
    return (
      <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3 text-sm">
        <span className="font-medium">{institution.name_ar}</span>
        {institution.name_he && <span className="text-muted">{institution.name_he}</span>}
        <span className="rounded-full bg-foreground/10 px-2 text-xs">{INSTITUTION_KIND_LABEL[institution.kind]}</span>
        {doctors.length === 0 ? (
          <span className="tabular-nums text-muted">لا أطباء</span>
        ) : (
          <details className="text-muted">
            <summary className="cursor-pointer tabular-nums hover:text-foreground">
              {countOf(doctors.length, DOCTORS)}
            </summary>
            <ul className="mt-1 list-disc ps-5 text-foreground">
              {doctors.map((d) => (
                <li key={d.id}>
                  <Link href={panelHref(d.id)} className="underline underline-offset-2 hover:no-underline">
                    {d.name}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
        {institution.aliases.length > 0 && (
          <span className="w-full text-xs text-muted">تُكتب أيضًا: {institution.aliases.join("، ")}</span>
        )}
        <span className="ms-auto flex gap-2">
          <button type="button" className="underline" onClick={() => setEditing(true)}>تعديل</button>
          <button type="button" className="text-danger underline" disabled={disabled} onClick={onDelete}>حذف</button>
        </span>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 p-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input className="input" value={form.name_ar} aria-label="الاسم بالعربية"
          onChange={(e) => setForm({ ...form, name_ar: e.target.value })} />
        <input className="input" value={form.name_he} aria-label="الاسم بالعبرية"
          onChange={(e) => setForm({ ...form, name_he: e.target.value })} />
        <select className="input" value={form.kind} aria-label="النوع"
          onChange={(e) => setForm({ ...form, kind: e.target.value as InstitutionKind })}>
          {INSTITUTION_KINDS.map((k) => (
            <option key={k} value={k}>{INSTITUTION_KIND_LABEL[k]}</option>
          ))}
        </select>
      </div>
      <textarea className="input min-h-16" value={form.aliases} aria-label="طرق كتابة أخرى"
        onChange={(e) => setForm({ ...form, aliases: e.target.value })} />
      <div className="flex gap-2">
        <button type="button" disabled={disabled} className="rounded-md bg-primary px-3 py-1.5 text-primary-fg disabled:opacity-50"
          onClick={async () => {
            const ok = await onSave({
              name_ar: form.name_ar,
              name_he: form.name_he || null,
              kind: form.kind,
              aliases: splitAliases(form.aliases),
            });
            if (ok) setEditing(false);
          }}>
          حفظ
        </button>
        <button type="button" className="underline" onClick={() => setEditing(false)}>إلغاء</button>
      </div>
    </li>
  );
}
