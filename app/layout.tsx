import type { Metadata } from "next";
import { Noto_Naskh_Arabic } from "next/font/google";
import "./globals.css";

const naskh = Noto_Naskh_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "دليل أطباء القدس",
  description: "دليل مهني مغلق للأطباء المسجلين في القدس",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${naskh.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-arabic">{children}</body>
    </html>
  );
}
