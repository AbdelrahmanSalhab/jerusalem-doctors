"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Search bar shown to anonymous visitors on the landing page. Any attempt to
 * use it (focus, type, submit) opens a modal directing the visitor to sign
 * in. The directory is closed by spec — search is gated behind auth.
 */
export function PublicSearchBar() {
  const [showModal, setShowModal] = useState(false);

  const block = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    setShowModal(true);
  };

  return (
    <>
      <form
        onSubmit={block}
        className="mx-auto flex max-w-2xl flex-col items-stretch gap-2 sm:flex-row sm:items-center"
      >
        <input
          type="text"
          readOnly
          onFocus={block}
          onClick={block}
          onKeyDown={block}
          placeholder="ابحث بالاسم، التخصص، أو التخصص الفرعي..."
          className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-transparent px-4 py-3 text-base outline-none focus:border-foreground md:px-5 md:py-4 md:text-lg"
          aria-label="بحث"
        />
        <button
          type="button"
          onClick={block}
          className="rounded-md bg-foreground px-5 py-3 text-background hover:opacity-90 md:px-7 md:py-4 md:text-lg"
        >
          بحث
        </button>
      </form>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-xl font-bold">البحث متاح للأطباء فقط</h2>
            <p className="mb-5 text-sm text-foreground/80">
              دليل أطباء القدس منصة مهنية مغلقة. الرجاء تسجيل الدخول إذا كان
              لديك حساب، أو إنشاء حساب جديد للوصول إلى البحث والتواصل مع
              زملائك.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href="/login"
                className="flex-1 rounded-md border border-foreground/20 px-4 py-2 text-center hover:bg-foreground/5"
              >
                تسجيل الدخول
              </Link>
              <Link
                href="/signup"
                className="flex-1 rounded-md bg-foreground px-4 py-2 text-center text-background hover:opacity-90"
              >
                إنشاء حساب جديد
              </Link>
            </div>
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="mt-4 block w-full text-center text-sm text-foreground/60 hover:text-foreground"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
    </>
  );
}
