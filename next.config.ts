import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["10.0.96.15"],
  images: {
    remotePatterns: [
      // Supabase Storage public URLs
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/**" },
    ],
  },
};

export default nextConfig;
