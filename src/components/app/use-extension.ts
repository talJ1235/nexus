"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientPayload } from "@/lib/service";

type Pending = { resolve: (d: ClientPayload | null) => void; timer: ReturnType<typeof setTimeout> };

/** Talks to the Nexus Clipper extension (via its content script) when it's installed. */
export function useExtension() {
  const [version, setVersion] = useState<string | null>(null);
  const pending = useRef(new Map<string, Pending>());

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.source !== "nexus-ext") return;
      if (d.type === "hello") setVersion(String(d.version ?? "1"));
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

  return { available: version != null, version, resolve };
}
