import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import { headers } from "next/headers";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

// One family for both scripts: IBM Plex Sans for Latin (phone numbers,
// emails, English words) and its Arabic sister for Arabic. The Latin face
// comes first and covers only Latin, so the browser picks per character.
//
// Three weights, not four: 500 (font-medium) is so close to 400 that it was
// a whole extra file per script for a barely visible difference, and the
// browser now draws font-medium with the 400 file.
const plexLatin = IBM_Plex_Sans({
  variable: "--font-latin",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
});
const plex = IBM_Plex_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["400", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "دليل أطباء القدس",
  description: "دليل مهني مغلق للأطباء المسجلين في القدس",
  robots: { index: false, follow: false },
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
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${plexLatin.variable} ${plex.variable} h-full antialiased`}
      // data-theme is set by the boot script before React hydrates.
      suppressHydrationWarning
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col font-sans overflow-x-hidden">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  );
}
