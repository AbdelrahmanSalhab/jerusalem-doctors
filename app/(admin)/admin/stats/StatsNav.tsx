// Jump links to the sections of the stats page, which runs to a few screens.
// Plain anchors: the page is server-rendered and needs no script for this.

const SECTIONS = [
  ["doctors", "الأطباء"],
  ["activity", "النشاط"],
  ["contact", "التواصل"],
  ["otp", "رموز التحقق"],
  ["install", "الشاشة الرئيسية"],
  ["signup", "التسجيل والدخول"],
  ["who", "من هم الأطباء"],
  ["specialties", "التخصصات"],
  ["profiles", "اكتمال الملفات"],
  ["system", "النظام"],
  ["usage", "الاستخدام"],
] as const;

export function StatsNav() {
  return (
    <nav aria-label="أقسام الصفحة" className="-mt-4 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap">
      {SECTIONS.map(([id, label]) => (
        <a
          key={id}
          href={`#${id}`}
          className="shrink-0 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1 text-sm text-muted hover:border-foreground/40 hover:text-foreground pointer-coarse:py-3"
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
