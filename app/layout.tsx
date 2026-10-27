import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { InstallProvider } from "@/components/install/InstallProvider";
import { getCurrentDoctor } from "@/lib/auth/session";
import { INSTALL_CAPTURE_SCRIPT, INSTALL_OFFER_ATTR } from "@/lib/install/context";
import { SITE_URL } from "@/lib/site";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

// One family for both scripts: IBM Plex Sans for Latin (phone numbers,
// emails, English words) and its Arabic sister for Arabic. The Latin face
// comes first and covers only Latin, so the browser picks per character.
//
// Three weights, not four: 500 (font-medium) is so close to 400 that it was
// a whole extra file per script for a barely visible difference, and the
// browser now draws font-medium with the 400 file.
//
// The files live in app/fonts (Fontsource's subsets, SIL OFL, see OFL.txt)
// rather than coming from Google at build time: a Google outage used to fail
// the build. No generated Arial fallback face: it would draw Arabic before
// the Arabic face is reached (globals.css lists the two faces instead).
const plexLatin = localFont({
  variable: "--font-latin",
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600" },
    { path: "./fonts/ibm-plex-sans-latin-700-normal.woff2", weight: "700" },
  ],
  display: "swap",
  adjustFontFallback: false,
  // Latin is only phone numbers, emails and the odd word: not worth
  // preloading on every page. The Arabic faces are, the pages being Arabic.
  preload: false,
});
const plex = localFont({
  variable: "--font-arabic",
  src: [
    { path: "./fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2", weight: "600" },
    { path: "./fonts/ibm-plex-sans-arabic-arabic-700-normal.woff2", weight: "700" },
  ],
  display: "swap",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "دليل أطباء القدس",
  description: "دليل مهني مغلق للأطباء المسجلين في القدس",
  // Not indexed unless a page says so (lib/site.ts: /, /signup, /privacy).
  robots: { index: false, follow: false },
  // A shared link (WhatsApp, Telegram) shows the name, the line and the logo.
  openGraph: {
    type: "website",
    locale: "ar",
    siteName: "دليل أطباء القدس",
    title: "دليل أطباء القدس",
    description: "دليل مهني مغلق للأطباء المسجلين في القدس",
    images: [{ url: "/icon-512.png", width: 512, height: 512 }],
  },
  // iPhone "Add to Home Screen": the icon's name, and a full-screen launch.
  // "default" keeps the status bar above the page; "black-translucent" would
  // draw the clock over the header.
  appleWebApp: { capable: true, title: "أطباء القدس", statusBarStyle: "default" },
};

// Browser and status-bar colour, matching the header in each theme.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#212b27" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // proxy.ts sets a fresh nonce per request; only scripts carrying it run.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // Shared with the header's lookup (cache()): no extra request.
  const doctor = await getCurrentDoctor().catch(() => null);
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${plexLatin.variable} ${plex.variable} h-full antialiased`}
      // Signed in: the site offers installing itself (lib/install/context).
      {...(doctor?.is_active ? { [INSTALL_OFFER_ATTR]: "" } : {})}
      // data-theme is set by the boot script before React hydrates.
      suppressHydrationWarning
    >
      <head>
        {/* The CSP spec has the browser blank out the nonce attribute once the
            page is parsed, so React reads back nonce="" and reports a mismatch
            on hydration. The <html> suppression above only covers that element,
            not this one. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
        {/* Chrome's install event can come before React loads. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: INSTALL_CAPTURE_SCRIPT }}
        />
      </head>
      <body className="min-h-full flex flex-col font-sans overflow-x-hidden">
        {/* Installing to the home screen: the account menu and the
            dashboard share it, and it must outlive page changes. */}
        <InstallProvider signedIn={Boolean(doctor?.is_active)}>
          <SiteHeader />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </InstallProvider>
        <Analytics />
      </body>
    </html>
  );
}
