"use client";

import { useState, type CSSProperties } from "react";
import { hostOf } from "@/lib/stores";
import { cn } from "@/lib/utils";

// Fixed hues for stores people know by colour; everything else gets a stable hue from its key.
const KNOWN: Record<string, number> = { aliexpress: 5, temu: 1, amazon: 2, ikea: 3, ksp: 4, bug: 6, ivory: 7, ebay: 8 };
const HUES = 8;

export function storeHue(storeKey: string) {
  if (KNOWN[storeKey]) return KNOWN[storeKey];
  let h = 0;
  for (const ch of storeKey) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % HUES) + 1;
}

/** `--store` for the store-bar / store-tint / store-line helpers in globals.css. */
export function storeVar(storeKey: string): CSSProperties {
  return { "--store": `var(--store-${storeHue(storeKey)})` } as CSSProperties;
}

/**
 * A store's logo (its favicon, lazy) on a small rounded tile over a monogram in the store's hue. The logo fades in
 * only once it has really loaded; Google's favicon service answers unknown hosts with a 16 px globe, which counts as
 * "no logo", so the monogram stays.
 */
export function StoreMark({ store, storeKey, url, size = 20, className }: { store: string; storeKey: string; url?: string | null; size?: number; className?: string }) {
  const host = url ? hostOf(url) : "";
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  const letter = Array.from(store.trim())[0]?.toUpperCase() ?? "?";
  const check = (el: HTMLImageElement) => setState(el.naturalWidth >= 32 ? "ok" : "failed");

  return (
    <span aria-hidden style={{ width: size, height: size, ...storeVar(storeKey) }} className={cn("relative inline-grid shrink-0 overflow-hidden rounded-[28%]", className)}>
      {state !== "ok" && (
        <span style={{ fontSize: Math.round(size * 0.55) }} className="store-mono grid place-items-center font-semibold leading-none">
          {letter}
        </span>
      )}
      {host && state !== "failed" && (
        // eslint-disable-next-line @next/next/no-img-element -- tiny third-party favicon, sized by the service
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          width={size}
          height={size}
          // Loaded before hydration attached onLoad: check once here.
          ref={(el) => {
            if (el?.complete && el.naturalWidth > 0 && state === "loading") check(el);
          }}
          onLoad={(e) => check(e.currentTarget)}
          onError={() => setState("failed")}
          className={cn("absolute inset-0 size-full rounded-[28%] bg-white object-contain ring-1 ring-inset ring-line transition-opacity duration-200", state === "ok" ? "opacity-100" : "opacity-0")}
        />
      )}
    </span>
  );
}
