"use client";

// The two switches. Closing one is a single tap; opening one first shows what
// it gives up and asks again, because that is the direction that weakens a
// protection. The server writes the change to the activity log either way.

import { useState } from "react";
import { apiErrorMessage } from "@/lib/client/apiError";
import { SETTING_KEYS, type SettingKey, type SiteSettings } from "@/lib/siteSettings";
import type { SettingText } from "@/lib/siteSettingsText";

type Notice = { key: SettingKey; ok: boolean; message: string };

function Switch({ on, busy, label, onToggle }: { on: boolean; busy: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={onToggle}
      className="flex min-h-11 shrink-0 items-center gap-2 rounded-md px-1 disabled:opacity-60 pointer-coarse:min-h-12"
    >
      <span className="text-sm font-semibold" aria-hidden="true">
        {on ? "مفتوح" : "مغلق"}
      </span>
      <span
        aria-hidden="true"
        className={`flex h-7 w-12 items-center rounded-full border p-0.5 transition-colors ${on ? "justify-end border-warn-solid bg-warn-solid" : "justify-start border-line bg-foreground/10"}`}
      >
        <span className="size-5 rounded-full bg-surface shadow" />
      </span>
    </button>
  );
}

function Paragraph({ heading, tone, children }: { heading: string; tone?: "warn"; children: string }) {
  return (
    <div className={tone === "warn" ? "rounded-md border border-warn-line bg-warn-bg p-3 text-warn" : ""}>
      <h3 className="text-sm font-semibold">{heading}</h3>
      <p className={`mt-0.5 text-sm leading-7 ${tone === "warn" ? "" : "text-muted"}`}>{children}</p>
    </div>
  );
}

export function SettingsForm({ initial, text }: { initial: SiteSettings; text: Record<SettingKey, SettingText> }) {
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState<SettingKey | null>(null);
  const [confirming, setConfirming] = useState<SettingKey | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function save(key: SettingKey, enabled: boolean) {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: enabled }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ key, ok: false, message: apiErrorMessage(body.code) });
        return;
      }
      setValues((v) => ({ ...v, [key]: body[key] === true }));
      setConfirming(null);
      setNotice({
        key,
        ok: true,
        message: enabled ? "فُتح المفتاح. أُبلغ بقية المشرفين وسُجّل ذلك باسمك." : "أُعيد إغلاق المفتاح.",
      });
    } catch {
      setNotice({ key, ok: false, message: apiErrorMessage(undefined) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {SETTING_KEYS.map((key) => {
        const on = values[key];
        const t = text[key];
        const id = `setting-${key}`;
        return (
          <section key={key} aria-labelledby={id} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 id={id} className="text-lg font-bold">
                {t.title}
              </h2>
              <Switch
                on={on}
                busy={busy === key}
                label={t.title}
                onToggle={() => (on ? void save(key, false) : setConfirming(confirming === key ? null : key))}
              />
            </div>

            <Paragraph heading={on ? "ما يحدث الآن (مفتوح)" : "ما يحدث الآن (مغلق)"}>{on ? t.open : t.closed}</Paragraph>
            <Paragraph heading={on ? "ما كان يحدث وهو مغلق" : "ما يحدث إن فتحته"}>{on ? t.closed : t.open}</Paragraph>
            <Paragraph heading="ما تتنازل عنه" tone="warn">
              {t.gives}
            </Paragraph>
            <Paragraph heading="ما يبقى محميًا">{t.stays}</Paragraph>

            {confirming === key && !on && (
              <div role="group" aria-label={`تأكيد فتح ${t.title}`} className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <p className="w-full text-sm font-semibold">هل تفتح «{t.title}»؟</p>
                <button
                  type="button"
                  disabled={busy === key}
                  onClick={() => void save(key, true)}
                  className="rounded-md border border-danger-solid bg-danger-solid px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 pointer-coarse:py-3"
                >
                  {busy === key ? "جارٍ الحفظ…" : "نعم، افتحه"}
                </button>
                <button
                  type="button"
                  disabled={busy === key}
                  onClick={() => setConfirming(null)}
                  className="rounded-md border border-line px-4 py-2 text-sm pointer-coarse:py-3"
                >
                  إلغاء
                </button>
              </div>
            )}

            {notice?.key === key && (
              <p role={notice.ok ? "status" : "alert"} className={`text-sm font-semibold ${notice.ok ? "text-success" : "text-danger"}`}>
                {notice.message}
              </p>
            )}
          </section>
        );
      })}
      <p className="max-w-3xl text-sm leading-7 text-muted">
        إن فتحتَ المفتاحين معًا: الطبيب الذي لم يُقبل بعد يبحث ويرى البطاقات، لكن أرقام الزملاء تبقى عنده خلف النقر.
        والأرقام المباشرة تُعرض للأطباء المقبولين وحدهم.
      </p>
    </div>
  );
}
