import type { MetadataRoute } from "next";

// Lets doctors add the directory to their home screen and open it like an
// app. No offline copy on purpose: cached doctor details would stay on a
// lost or shared phone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "دليل أطباء القدس",
    short_name: "أطباء القدس",
    description: "دليل مهني مغلق لأطباء القدس",
    lang: "ar",
    dir: "rtl",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#0e1210",
    theme_color: "#0e1210",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
