"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { dictionaries, fmt, LOCALE_COOKIE, type Dict, type Locale } from "@/lib/i18n";

type I18n = { locale: Locale; t: Dict; f: typeof fmt; setLocale: (l: Locale) => void; dir: "ltr" | "rtl" };
const I18nContext = createContext<I18n | null>(null);

export function useI18n() {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n outside provider");
  return v;
}

export function Providers({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const setLocale = useCallback((l: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }, []);
  const value = useMemo<I18n>(
    () => ({ locale, t: dictionaries[locale], f: fmt, setLocale, dir: locale === "he" ? "rtl" : "ltr" }),
    [locale, setLocale],
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <I18nContext.Provider value={value}>
        {children}
        <Toaster
          position={locale === "he" ? "bottom-left" : "bottom-right"}
          dir={value.dir}
          toastOptions={{
            classNames: {
              toast: "!bg-raised !text-fg !border !border-line !shadow-pop !rounded-xl !font-sans",
              description: "!text-muted",
              actionButton: "!bg-accent !text-accent-fg",
            },
          }}
        />
      </I18nContext.Provider>
    </ThemeProvider>
  );
}
