"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { Toaster } from "sonner";
import { markBooted } from "@/lib/boot";
import { dictionaries, fmt, LOCALE_COOKIE, type Dict, type Locale } from "@/lib/i18n";
import { z } from "zod";

// R15 B4: no `new Function` probe under the strict CSP (zod would report a caught eval as a CSP violation).
z.config({ jitless: true });

type I18n = { locale: Locale; t: Dict; f: typeof fmt; setLocale: (l: Locale) => void; dir: "ltr" | "rtl" };
const I18nContext = createContext<I18n | null>(null);

export function useI18n() {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n outside provider");
  return v;
}

/** Polish #22: Sonner defaults to its light theme; give it the resolved one (inside ThemeProvider) so its own parts
 *  (loading / rich icons, anything classNames don't override) follow dark mode. */
function ThemedToaster(props: React.ComponentProps<typeof Toaster>) {
  const { resolvedTheme } = useTheme();
  return <Toaster theme={resolvedTheme === "dark" ? "dark" : "light"} {...props} />;
}

const PHONE = "(max-width: 768px)";
const subscribePhone = (cb: () => void) => {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export function Providers({ locale, nonce, children }: { locale: Locale; nonce?: string; children: React.ReactNode }) {
  const setLocale = useCallback((l: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }, []);
  // Pages without the app shell (login, shared lists) are ready once hydrated; the app marks itself when its data is in.
  useEffect(() => {
    if (!document.querySelector("[data-app-shell]")) markBooted();
  }, []);
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);
  const value = useMemo<I18n>(
    () => ({ locale, t: dictionaries[locale], f: fmt, setLocale, dir: locale === "he" ? "rtl" : "ltr" }),
    [locale, setLocale],
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
      <I18nContext.Provider value={value}>
        {children}
        {/* Look + motion overrides live in globals.css ("Toasts"). Normal 4 s, with an action (Undo) 7 s; hover pauses. */}
        <ThemedToaster
          position={phone ? "bottom-center" : locale === "he" ? "bottom-left" : "bottom-right"}
          dir={value.dir}
          closeButton
          swipeDirections={phone ? ["left", "right", "bottom"] : ["left", "right"]}
          toastOptions={{
            closeButtonAriaLabel: value.t.view.dismiss,
            classNames: {
              toast: "!bg-raised !text-fg !border !border-line !shadow-pop !rounded-xl !font-sans",
              title: "nx-toast-title",
              description: "!text-muted nx-toast-desc",
              actionButton: "!bg-accent !text-accent-fg",
            },
          }}
        />
      </I18nContext.Provider>
    </ThemeProvider>
  );
}
