import type { NextConfig } from "next";

const SECURITY_HEADERS = [
  // Prevent embedding (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  // Prevent MIME-sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Strip Referer when navigating cross-origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deny access to powerful browser APIs we never use.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["10.0.96.15"],
  // Drop the `x-powered-by: Next.js` response header — minor fingerprint
  // reduction; closes pentest finding L1.
  poweredByHeader: false,
  images: {
    remotePatterns: [
      // Supabase Storage public URLs
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/**" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
