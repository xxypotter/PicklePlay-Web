import type { MetadataRoute } from "next";

/**
 * PWA manifest — this is what makes "Add to Home Screen" produce something that
 * opens without browser chrome and looks like the native app we didn't build.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PicklePlay",
    short_name: "PicklePlay",
    description: "Organize pickleball sessions and track ratings.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#15803d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
