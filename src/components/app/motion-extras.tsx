"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/providers";
import { LogoMark } from "@/components/logo";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStore } from "./store";

const PULL_AT = 72;

/**
 * Phone: pull down at the top to reload. Chrome's own pull-to-refresh (the blue circle Tal saw, which reloaded the
 * page on top of ours) is off — the root has `overscroll-behavior-y: contain` — and releasing past the threshold now
 * reloads the page into the boot sequence (Round 10 A3). Offline it isn't armed (a reload would leave the snapshot).
 */
export function PullToRefresh() {
  const s = useStore();
  const { t } = useI18n();
  const [dy, setDy] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);
  const dyRef = useRef(0);

  useEffect(() => {
    if (s.loading || s.offlineAt != null) return;
    const phone = () => window.matchMedia("(max-width: 1023px)").matches;
    const down = (e: TouchEvent) => {
      if (!phone() || window.scrollY > 0 || busy || document.querySelector('[role="dialog"]')) return;
      start.current = e.touches[0].clientY;
    };
    const move = (e: TouchEvent) => {
      if (start.current == null) return;
      const d = e.touches[0].clientY - start.current;
      if (d <= 0) {
        dyRef.current = 0;
        setDy(0);
        return;
      }
      dyRef.current = Math.min(120, d * 0.5);
      setDy(dyRef.current);
    };
    const up = async () => {
      if (start.current == null) return;
      start.current = null;
      const pulled = dyRef.current >= PULL_AT;
      dyRef.current = 0;
      setDy(0);
      if (!pulled) return;
      setBusy(true);
      try {
        navigator.vibrate?.(15);
      } catch {}
      setTimeout(() => window.location.reload(), 260);
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [s, busy, t]);

  if (!dy && !busy) return null;
  const k = busy ? 1 : Math.min(1, dy / PULL_AT);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center pt-[max(10px,env(safe-area-inset-top))] lg:hidden" aria-live="polite" data-pull>
      <span
        className={cn("grid size-11 place-items-center rounded-full border border-line bg-surface shadow-card", busy && "box-think")}
        style={{ transform: `translateY(${busy ? 52 : dy}px) rotate(${k * 240}deg) scale(${0.6 + 0.4 * k})`, opacity: k, transition: dy ? "none" : "transform 300ms var(--ease-out)" }}
      >
        <LogoMark className="size-6" />
      </span>
    </div>
  );
}

/** One short, tasteful burst when a project's last item is bought (or ordered). */
export function Celebration() {
  const s = useStore();
  const { t, f } = useI18n();
  const prev = useRef<Map<string, number> | null>(null);
  const [burst, setBurst] = useState<{ name: string; at: number } | null>(null);

  useEffect(() => {
    if (s.loading) return;
    const left = new Map<string, number>();
    for (const c of s.collections) if (c.kind === "project") left.set(c.id, 0);
    const total = new Map<string, number>();
    for (const i of s.items) {
      if (!i.collectionId || !left.has(i.collectionId)) continue;
      total.set(i.collectionId, (total.get(i.collectionId) ?? 0) + 1);
      if (i.status === "to_buy") left.set(i.collectionId, left.get(i.collectionId)! + 1);
    }
    const before = prev.current;
    prev.current = left;
    if (!before) return;
    for (const [id, n] of left) {
      if (n === 0 && (before.get(id) ?? 0) > 0 && (total.get(id) ?? 0) >= 2) {
        const name = s.collections.find((c) => c.id === id)?.name ?? "";
        // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-off reaction to the data changing
        setBurst({ name, at: Date.now() });
        toast.success(f(t.celebrate.done, { name }));
        break;
      }
    }
  }, [s.items, s.collections, s.loading, t, f]);

  useEffect(() => {
    if (!burst) return;
    const id = setTimeout(() => setBurst(null), 1600);
    return () => clearTimeout(id);
  }, [burst]);

  if (!burst) return null;
  const colors = ["var(--spark)", "var(--brand)", "var(--proj-green)", "var(--proj-blue)", "var(--proj-rose)", "var(--logo-c3)"];
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[18vh] z-50 flex justify-center" aria-hidden data-celebrate>
      <div className="relative size-0">
        {Array.from({ length: 22 }, (_, i) => {
          const a = (i / 22) * Math.PI * 2;
          const r = 90 + (i % 4) * 22;
          return (
            <i
              key={`${burst.at}-${i}`}
              className="confetti absolute size-2.5 rounded-[3px]"
              style={{ background: colors[i % colors.length], "--tx": `${Math.cos(a) * r}px`, "--ty": `${Math.sin(a) * r}px`, animationDelay: `${(i % 5) * 18}ms` } as React.CSSProperties}
            />
          );
        })}
      </div>
    </div>
  );
}
