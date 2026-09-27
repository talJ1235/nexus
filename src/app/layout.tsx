import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/rubik";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SwRegister } from "@/components/sw-register";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Nexus",
  description: "Everything you plan to buy, in one place",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }, { url: "/icons/favicon-48.png", sizes: "48x48" }], apple: "/icons/icon-192.png" },
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Nexus", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#111316" },
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const raw = jar.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(raw) ? raw : "en";
  return (
    <html lang={locale} dir={locale === "he" ? "rtl" : "ltr"} suppressHydrationWarning>
      <body>
        <Providers locale={locale}>{children}</Providers>
        <SwRegister />
      </body>
    </html>
  );
}
