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
  // Keep other sites' windows (a page we link to, or one that opens us) from
  // holding a reference to ours. The Content-Security-Policy is per request,
  // with a nonce, so it is set in proxy.ts rather than here.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// Photos come from our own Supabase project only; a wildcard would let the
// image optimizer be pointed at any project's bucket on our quota.
const SUPABASE_HOST = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : "*.supabase.co";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["10.0.96.15"],
  // Drop the `x-powered-by: Next.js` response header, minor fingerprint
  // reduction; closes pentest finding L1.
  poweredByHeader: false,
  images: {
    remotePatterns: [
      // Supabase Storage public URLs
      { protocol: "https", hostname: SUPABASE_HOST, pathname: "/storage/**" },
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
