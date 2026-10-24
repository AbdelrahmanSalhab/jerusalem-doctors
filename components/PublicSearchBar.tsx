"use client";

// The home page's search bar for visitors. The directory is for signed-in
// doctors only, so trying to search (a tap or click on the bar, Enter or
// Space in it, or the button) opens a box that sends them to sign up or sign
// in. A native <dialog> keeps focus inside it and closes on Escape; the bar
// does not react to focus alone, so Tab passes through it and closing the box
// doesn't reopen it.

import Link from "next/link";
import { useRef } from "react";

export function PublicSearchBar() {
  const dialog = useRef<HTMLDialogElement>(null);
  const open = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    dialog.current?.showModal();
  };

  return (
    <>
      <form onSubmit={open} className="mx-auto flex w-full max-w-2xl flex-col gap-2 sm:flex-row">
        <input
          type="search"
          readOnly
          onClick={open}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") open(e);
          }}
          placeholder="ابحث عن طبيب بالاسم أو التخصص أو مكان العمل"
          aria-label="بحث"
          aria-haspopup="dialog"
          className="min-w-0 flex-1 cursor-pointer rounded-md border border-line bg-surface px-4 py-3 text-base"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-6 py-3 font-semibold text-primary-fg hover:opacity-90"
        >
          بحث
        </button>
      </form>

      <dialog
        ref={dialog}
        aria-labelledby="search-gate-title"
        // A click on the backdrop (the dialog itself, outside its box) closes it.
        onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-line bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50"
      >
        <div className="flex flex-col gap-4 p-6 text-start">
          <h2 id="search-gate-title" className="text-xl font-bold">
            البحث متاح للأطباء المسجّلين فقط
          </h2>
          <p className="text-sm text-muted">
            سجّل برقم هاتفك ورقم الترخيص لتبحث عن زملائك وتتواصل معهم. إن كان لديك حساب، سجّل الدخول.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              href="/signup"
              className="flex-1 rounded-md bg-primary px-4 py-3 text-center font-semibold text-primary-fg hover:opacity-90"
            >
              إنشاء حساب
            </Link>
            <Link
              href="/login"
              className="flex-1 rounded-md border border-line px-4 py-3 text-center hover:bg-foreground/5"
            >
              تسجيل الدخول
            </Link>
          </div>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="text-sm text-muted underline hover:text-foreground"
          >
            إغلاق
          </button>
        </div>
      </dialog>
    </>
  );
}
