"use client";

// How to add the directory to the home screen by hand, for every browser
// without a native install prompt (InstallProvider). Closing it says
// nothing about whether the doctor installed it. A native <dialog>: focus
// stays inside, Escape and a tap outside close it.

import { useEffect, useRef, useState } from "react";
import type { InstallGuide } from "@/lib/install/context";

/** The browser's own symbols, drawn like the button the step names, so
 *  the doctor matches a picture rather than a description. */
const ICONS = {
  share: (
    <>
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 11v9h12v-9" />
    </>
  ),
  addHome: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  menu: (
    <>
      <circle cx="12" cy="5" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="19" r="1.5" fill="currentColor" />
    </>
  ),
  install: (
    <>
      <path d="M12 4v11" />
      <path d="M8 11l4 4 4-4" />
      <path d="M5 19h14" />
    </>
  ),
  installDesktop: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M12 7v6M9.5 10.5L12 13l2.5-2.5" />
      <path d="M8 20h8" />
    </>
  ),
};
type Step = { text: string; icon?: keyof typeof ICONS };

const STEPS: Record<Exclude<InstallGuide, "in-app">, { title: string; steps: Step[]; note?: string }> = {
  "ios-safari": {
    title: "أضف الدليل إلى شاشتك الرئيسية",
    steps: [
      {
        icon: "share",
        text: "اضغط زر المشاركة (مربع يخرج منه سهم) في شريط Safari، أو افتح قائمة الصفحة ثم «مشاركة».",
      },
      { icon: "addHome", text: "اختر «إضافة إلى الشاشة الرئيسية»." },
      { text: "أبقِ «فتح كتطبيق ويب» مفعّلًا إن ظهر، ثم اضغط «إضافة»." },
    ],
  },
  "ios-other": {
    title: "أضف الدليل إلى شاشتك الرئيسية",
    steps: [
      { icon: "share", text: "اضغط زر المشاركة في المتصفح (في Chrome تجده بجانب شريط العنوان)." },
      { icon: "addHome", text: "اختر «إضافة إلى الشاشة الرئيسية»." },
      { text: "اضغط «إضافة»." },
    ],
    note: "لا تجد الخيار؟ افتح الموقع في Safari واتبع الخطوات نفسها.",
  },
  android: {
    title: "أضف الدليل إلى شاشتك الرئيسية",
    steps: [
      { icon: "menu", text: "افتح قائمة المتصفح (النقاط الثلاث)." },
      { icon: "install", text: "اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»." },
      { text: "اضغط «تثبيت»." },
    ],
  },
  other: {
    title: "أضف الدليل إلى جهازك",
    steps: [
      { icon: "share", text: "على الهاتف: من قائمة المتصفح أو زر المشاركة، اختر «إضافة إلى الشاشة الرئيسية»." },
      { icon: "installDesktop", text: "على الحاسوب، في Chrome أو Edge: اضغط أيقونة التثبيت في شريط العنوان." },
      { text: "في Safari على Mac: من قائمة «ملف» اختر «إضافة إلى Dock»." },
    ],
  },
};

function StepIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    // Decorative: the step's words say the same.
    <span
      aria-hidden="true"
      className="me-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md border border-line bg-surface align-middle text-primary"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[name]}
      </svg>
    </span>
  );
}

export function InstallHelpDialog({
  open,
  guide,
  onClose,
}: {
  open: boolean;
  guide: InstallGuide;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="install-help-title"
      onClose={onClose}
      // A tap on the backdrop (the dialog itself, outside its box) closes it.
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-line bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-4 p-6 text-start">
        {guide === "in-app" ? <InAppHelp /> : <Steps {...STEPS[guide]} />}
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="rounded-md border border-line px-4 py-2.5 hover:bg-foreground/5"
        >
          إغلاق
        </button>
      </div>
    </dialog>
  );
}

function Steps({ title, steps, note }: { title: string; steps: Step[]; note?: string }) {
  return (
    <>
      <h2 id="install-help-title" className="text-xl font-bold">
        {title}
      </h2>
      <ol className="flex list-decimal flex-col gap-3 ps-5 leading-7">
        {steps.map((s) => (
          <li key={s.text}>
            {s.icon && <StepIcon name={s.icon} />}
            {s.text}
          </li>
        ))}
      </ol>
      {note && <p className="text-sm text-muted">{note}</p>}
      <p className="text-sm text-muted">بعدها تفتح الدليل من أيقونته على الشاشة الرئيسية، كأي تطبيق.</p>
    </>
  );
}

/** Inside WhatsApp, Instagram and the like: open the page in a real browser
 *  first. Only the site's public address is copied. */
function InAppHelp() {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
  };
  return (
    <>
      <h2 id="install-help-title" className="text-xl font-bold">
        افتح الدليل في المتصفح أولًا
      </h2>
      <p>
        فتحت الرابط داخل تطبيق آخر (مثل واتساب)، ولا يمكن إضافة الدليل من هنا. افتح قائمة هذه الصفحة واختر «فتح في
        المتصفح»، أو انسخ الرابط والصقه في Chrome أو Safari، ثم أضِف الدليل من هناك.
      </p>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          dir="ltr"
          aria-label="رابط الدليل"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-base"
        />
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md bg-primary px-4 py-2 font-semibold text-primary-fg hover:opacity-90"
        >
          نسخ الرابط
        </button>
      </div>
      {copied === "yes" && (
        <p role="status" className="text-sm text-success">
          نُسخ الرابط.
        </p>
      )}
      {copied === "no" && (
        <p role="status" className="text-sm text-muted">
          لم يُنسخ تلقائيًا: اضغط على الرابط لتحديده ثم انسخه.
        </p>
      )}
    </>
  );
}
