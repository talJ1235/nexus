import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nexus",
    short_name: "Nexus",
    description: "Everything you plan to buy, in one place",
    // Hotfix 2026-10-07: a stable app identity and an explicit scope, so the installed app keeps every page of the
    // origin in its own window (Android).
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b0b0b",
    theme_color: "#0b0b0b",
    // ?v= bumps make Android notice new icons (installed app splash/launcher) on its next manifest check.
    icons: [
      { src: "/icons/icon-192.png?v=3", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png?v=3", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png?v=3", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // R18 S2 A1: long-press the app icon → the supermarket's quick actions (the dock's long-press menu, same targets).
    shortcuts: [
      { name: "Add to list", short_name: "Add", url: "/?v=supermarket&do=add", icons: [{ src: "/icons/icon-192.png?v=3", sizes: "192x192" }] },
      { name: "Scan a barcode", short_name: "Scan", url: "/?v=supermarket&do=scan", icons: [{ src: "/icons/icon-192.png?v=3", sizes: "192x192" }] },
      { name: "Photo of a product", short_name: "Photo", url: "/?v=supermarket&do=photo", icons: [{ src: "/icons/icon-192.png?v=3", sizes: "192x192" }] },
      { name: "Start shopping", short_name: "Shop", url: "/?v=supermarket&do=shop", icons: [{ src: "/icons/icon-192.png?v=3", sizes: "192x192" }] },
    ],
    share_target: {
      action: "/share",
      method: "GET",
      // R17 S5 S6: Chrome warns on every page without it ("Enctype should be set…"); GET sends the fields as a query.
      enctype: "application/x-www-form-urlencoded",
      params: { title: "title", text: "text", url: "url" },
    },
  } as MetadataRoute.Manifest;
}
