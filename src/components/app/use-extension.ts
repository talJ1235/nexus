"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientPayload } from "@/lib/service";

type Pending = { resolve: (d: ClientPayload | null) => void; timer: ReturnType<typeof setTimeout> };
export type SearchHit = { url: string; title: string | null; price: string | null };
type PendingSearch = { resolve: (d: SearchHit[]) => void; timer: ReturnType<typeof setTimeout> };

// Last version the extension announced on this page (diagnostics: assistant help, problem reports).
let knownVersion: string | null = null;
export const extensionVersion = () => knownVersion;

/** R15 D2: the extension is retired for everyone — the app ignores it (code kept for a later return). */
export const EXTENSION_RETIRED = true;

/** Talks to the Nexus Clipper extension (via its content script) when it's installed. */
export function useExtension() {
  const [version, setVersion] = useState<string | null>(null);
  const pending = useRef(new Map<string, Pending>());
  const searches = useRef(new Map<string, PendingSearch>());

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.source !== "nexus-ext" || EXTENSION_RETIRED) return;
      if (d.type === "hello") {
        knownVersion = String(d.version ?? "1");
        setVersion(knownVersion);
      }
      if (d.type === "searched") {
        const p = searches.current.get(d.id);
        if (!p) return;
        clearTimeout(p.timer);
        searches.current.delete(d.id);
        p.resolve(d.ok && Array.isArray(d.results) ? (d.results as SearchHit[]) : []);
      }
      if (d.type === "resolved") {
        const p = pending.current.get(d.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.current.delete(d.id);
        p.resolve(d.ok && d.data?.url ? (d.data as ClientPayload) : null);
      }
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ source: "nexus-app", type: "ping" }, window.location.origin);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const resolve = useCallback(
    (url: string) =>
      new Promise<ClientPayload | null>((res) => {
        const id = Math.random().toString(36).slice(2);
        const timer = setTimeout(() => {
          pending.current.delete(id);
          res(null);
        }, 40000);
        pending.current.set(id, { resolve: res, timer });
        window.postMessage({ source: "nexus-app", type: "resolve", id, url }, window.location.origin);
      }),
    [],
  );

  /** Search stores in the owner's browser (extension ≥ 1.3): Google Shopping + web result links. */
  const search = useCallback(
    (queries: string[]) =>
      new Promise<SearchHit[]>((res) => {
        const id = Math.random().toString(36).slice(2);
        const timer = setTimeout(() => {
          searches.current.delete(id);
          res([]);
        }, 60000);
        searches.current.set(id, { resolve: res, timer });
        window.postMessage({ source: "nexus-app", type: "search", id, queries }, window.location.origin);
      }),
    [],
  );

  return { available: version != null, version, resolve, search, canSearch: version != null && version.localeCompare("1.3.0", undefined, { numeric: true }) >= 0 };
}
