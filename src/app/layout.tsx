import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { Providers } from "@/components/providers";
import { heeboHebrew, heeboLatin } from "./fonts";
import { SwRegister } from "@/components/sw-register";
import { BootScreen } from "@/components/boot-screen";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { DEFAULT_PALETTE, isPalette, PALETTE_BG, PALETTE_COOKIE } from "@/lib/palette";

export const metadata: Metadata = {
  title: "Nexus",
  description: "Everything you plan to buy, in one place",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icons/favicon.svg?v=3", type: "image/svg+xml" }, { url: "/icons/favicon-48.png?v=3", sizes: "48x48" }], apple: "/icons/apple-touch-icon.png?v=3" },
  robots: { index: false, follow: false },
  other: { "nexus-app": "1" },
  appleWebApp: { capable: true, title: "Nexus", statusBarStyle: "black-translucent" },
};

export async function generateViewport(): Promise<Viewport> {
  const pal = (await cookies()).get(PALETTE_COOKIE)?.value;
  const bg = PALETTE_BG[isPalette(pal) ? pal : DEFAULT_PALETTE];
  return {
    themeColor: [
      { media: "(prefers-color-scheme: dark)", color: bg.dark },
      { media: "(prefers-color-scheme: light)", color: bg.light },
    ],
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const raw = jar.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(raw) ? raw : "en";
  const pal = jar.get(PALETTE_COOKIE)?.value;
  const palette = isPalette(pal) ? pal : DEFAULT_PALETTE;
  // R15 B4: the per-request CSP nonce (src/proxy.ts) for the inline scripts.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang={locale} dir={locale === "he" ? "rtl" : "ltr"} data-palette={palette} className={`${heeboLatin.variable} ${heeboHebrew.variable}`} suppressHydrationWarning>
      <body>
        <BootScreen nonce={nonce} />
        <Providers locale={locale} nonce={nonce}>
          {children}
        </Providers>
        <SwRegister />
      </body>
    </html>
  );
}
