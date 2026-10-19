const LINKEDIN_URL = "https://www.linkedin.com/in/abdelrahman-salhab/";
const WHATSAPP_URL = "https://wa.me/972524209156";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-4 text-sm text-muted">
        <nav className="flex flex-wrap gap-x-4 gap-y-1">
          <a href="/privacy" className="hover:text-foreground hover:underline">
            الخصوصية
          </a>
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
            مساعدة عبر واتساب
          </a>
        </nav>
        <p className="text-xs">
          تطوير:{" "}
          <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
            عبدالرحمن سلهب
          </a>
        </p>
      </div>
    </footer>
  );
}
