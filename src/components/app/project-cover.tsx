"use client";

import { useMemo } from "react";
import { flushSync } from "react-dom";
import { Folder, List } from "lucide-react";
import { budgetStats, countable, sumTotals } from "@/lib/calc";
import type { Collection, ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProductImage } from "./item-card";
import { useStore, type View } from "./store";
import { COLLECTION_COLORS } from "./view-items";

/** Everything a project card / header shows (Round 9 E1). */
export function useProjectStats(c: Collection) {
  const s = useStore();
  return useMemo(() => {
    const items = s.items.filter((i) => i.collectionId === c.id);
    const open = items.filter((i) => i.status === "to_buy");
    const toBuy = countable(open, s.altGroups, s.rates);
    const left = sumTotals(toBuy, s.rates, s.currency).total;
    const bought = items.filter((i) => i.status !== "to_buy").length;
    const urgent = open.filter((i) => i.priority === "urgent").length;
    const onTheWay = items.filter((i) => i.status === "ordered").length;
    // Next to buy: the first urgent one, else the oldest still open.
    const next = [...open].sort((a, b) => Number(b.priority === "urgent") - Number(a.priority === "urgent") || a.createdAt - b.createdAt)[0] ?? null;
    const b = c.kind === "project" ? budgetStats(c, s.items, s.altGroups, s.rates, s.currency) : null;
    // Cover collage: up to 4 pictures, open items first (urgent first), then the rest.
    const pics = [...open.sort((a, x) => Number(x.priority === "urgent") - Number(a.priority === "urgent")), ...items.filter((i) => i.status !== "to_buy")].filter((i) => i.imageUrl).slice(0, 4);
    return { items, toBuy, left, bought, urgent, onTheWay, next, b, pics };
  }, [c, s.items, s.altGroups, s.rates, s.currency]);
}

export const projectColor = (c: Collection) => COLLECTION_COLORS[c.color] ?? COLLECTION_COLORS.slate;
const vtName = (id: string) => `cover-${id.replace(/[^\w-]/g, "")}`;

/** Runs `go` inside a view transition where supported (reduced motion → plain). Only the covers carry a name. */
export function withCoverMorph(go: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) doc.startViewTransition(() => flushSync(go));
  else go();
}

/** Card → project page: the cover morphs into the page header (the way back is in the store's setView). */
export function openProject(id: string, setView: (v: View) => void) {
  withCoverMorph(() => setView({ type: "collection", id }));
}

const TILT = ["-7deg", "5deg", "-3deg", "8deg"];

/**
 * The project's cover: its colour as a soft, slightly saturated gradient wash and a collage of item pictures,
 * rounded and overlapping, that fans out on hover/press. `size`: card or page header.
 */
export function ProjectCover({ c, pics, size = "card", className }: { c: Collection; pics: ItemWithSources[]; size?: "card" | "header"; className?: string }) {
  const color = projectColor(c);
  const tile = size === "header" ? "size-[72px] rounded-[18px]" : "size-14 rounded-[16px] sm:size-16";
  return (
    <div
      // The cover rounds its own top corners (the card/header radius minus their 1 px border) instead of relying on
      // the parent's clip, which a view-transition snapshot doesn't carry — the corners stayed square, then snapped.
      className={cn("relative isolate overflow-hidden rounded-t-[25px]", className)}
      style={{ viewTransitionName: vtName(c.id), viewTransitionClass: "project-cover" } as React.CSSProperties}
      data-project-cover
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-10 saturate-[1.35]"
        style={{
          background: `radial-gradient(120% 100% at 100% 0%, color-mix(in oklab, ${color} 55%, transparent), transparent 62%), linear-gradient(135deg, color-mix(in oklab, ${color} 62%, var(--surface)), color-mix(in oklab, ${color} 24%, var(--surface)) 72%)`,
        }}
      />
      <div className="absolute inset-y-0 end-3 flex items-center ps-6 sm:end-4" aria-hidden>
        {pics.length ? (
          pics.map((p, i) => (
            <div
              key={p.id}
              className={cn(
                "relative -ms-5 overflow-hidden border-[3px] border-surface bg-surface shadow-[0_8px_18px_-6px_rgb(0_0_0/0.35)] transition-transform duration-[450ms] ease-[var(--ease-spring)] first:ms-0",
                tile,
                "group-hover:[transform:translateX(var(--fan))_rotate(var(--tilt))_translateY(-2px)] group-active:[transform:translateX(var(--fan))_rotate(var(--tilt))]",
              )}
              style={{ transform: `rotate(${TILT[i]})`, zIndex: 4 - i, "--tilt": `calc(${TILT[i]} * 1.6)`, "--fan": `${(i - (pics.length - 1) / 2) * 6}px` } as React.CSSProperties}
            >
              <ProductImage src={p.imageUrl} alt="" className="size-full" iconClass="size-5" />
            </div>
          ))
        ) : c.kind === "project" ? (
          <Folder className={cn("text-white/70 drop-shadow", size === "header" ? "size-16" : "size-12")} strokeWidth={1.4} />
        ) : (
          <List className={cn("text-white/70 drop-shadow", size === "header" ? "size-16" : "size-12")} strokeWidth={1.4} />
        )}
      </div>
    </div>
  );
}
