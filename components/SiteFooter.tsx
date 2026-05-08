const LINKEDIN_URL = "https://www.linkedin.com/in/abdelrahman-salhab/";
const WHATSAPP_URL = "https://wa.me/972524209156";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-foreground/10">
      <div className="mx-auto max-w-5xl px-6 py-4 text-center text-sm text-foreground/70">
        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <span>تطوير الموقع:</span>
          <span className="font-medium text-foreground">عبدالرحمن سلهب</span>
          <span aria-hidden="true">·</span>
          <a
            href={LINKEDIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            LinkedIn
          </a>
          <span aria-hidden="true">·</span>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            WhatsApp
          </a>
        </p>
      </div>
    </footer>
  );
}
