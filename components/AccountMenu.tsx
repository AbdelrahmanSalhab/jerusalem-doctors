"use client";

// The header's account control: the doctor's own photo, opening a small
// menu. Replaces the nav tabs row, which spent a whole line of a phone
// screen on links most doctors never press.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useInstall } from "@/components/install/InstallProvider";

export function AccountMenu({
  photoUrl,
  firstName,
  isAdmin,
  /** Doctors waiting for approval, shown next to الإدارة. */
  pending,
}: {
  photoUrl: string | null;
  firstName: string;
  isAdmin: boolean;
  pending: number;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const install = useInstall();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const logout = async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Best-effort, proceed to home regardless.
    }
    router.replace("/");
    router.refresh();
  };

  const item =
    "block w-full px-4 py-2.5 text-start text-sm hover:bg-foreground/5";

  return (
    <div ref={ref} className="relative">
      <button
        ref={toggle}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        // The badge's number is visible text, so the name has to include it.
        aria-label={isAdmin && pending > 0 ? `حسابي، ${pending} بانتظار القبول` : "حسابي"}
        className="relative flex rounded-full ring-1 ring-line hover:ring-foreground/40"
      >
        {/* Decorative: the button's name is its label, not the initial. */}
        <span aria-hidden="true" className="flex">
          <Avatar url={photoUrl} fallback={firstName} size="sm" alt="" />
        </span>
        {/* Admins see here that someone is waiting, without a tabs row. */}
        {isAdmin && pending > 0 && (
          <span
            aria-hidden="true"
            className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warn-solid px-1 text-[10px] font-semibold text-white"
          >
            {pending}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute end-0 top-full z-30 mt-2 w-44 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg"
        >
          <Link role="menuitem" href="/profile" onClick={() => setOpen(false)} className={item}>
            ملفي
          </Link>
          {isAdmin && (
            <Link role="menuitem" href="/admin" onClick={() => setOpen(false)} className={item}>
              الإدارة
              {pending > 0 && (
                <span className="ms-1.5 text-xs text-warn">({pending})</span>
              )}
            </Link>
          )}
          {/* Not inside the installed app, where it would offer itself. */}
          {install?.ready && !install.standalone && !install.installed && (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                // The dialog gives focus back to what had it, and this
                // item is about to go: hand it to the account button.
                toggle.current?.focus();
                setOpen(false);
                install.install("menu");
              }}
              disabled={install.prompting}
              className={item}
            >
              {install.guide === "other" ? "أضف الدليل إلى جهازي" : "أضف الدليل إلى هاتفي"}
            </button>
          )}
          <button role="menuitem" type="button" onClick={logout} disabled={busy} className={item}>
            {busy ? "..." : "تسجيل الخروج"}
          </button>
        </div>
      )}
    </div>
  );
}
