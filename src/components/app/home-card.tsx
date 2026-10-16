"use client";

import { useLayoutEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * R18 S5 D1: Home's cards have a fixed height (square phone cells, 196 px computer rows), so a list shows the rows that
 * fit whole: rows (repeated siblings) that would cross the card's inner bottom are hidden and counted into data-more;
 * a lone text block that still doesn't fit is clamped to the lines that do. Only inside the card grid (`.wv2`).
 */
export function useFitRows(ref: React.RefObject<HTMLElement | null>, more = 0) {
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card || !card.closest(".wv2")) return;
    const fit = () => {
      for (const el of card.querySelectorAll<HTMLElement>("[data-fit-hidden]")) {
        el.style.display = "";
        el.removeAttribute("data-fit-hidden");
      }
      for (const el of card.querySelectorAll<HTMLElement>("[data-fit-clamp]")) {
        el.style.removeProperty("-webkit-line-clamp");
        el.style.display = "";
        el.style.overflow = "";
        el.style.removeProperty("-webkit-box-orient");
        el.removeAttribute("data-fit-clamp");
      }
      const cr = card.getBoundingClientRect();
      const limit = cr.bottom - (parseFloat(getComputedStyle(card).paddingBottom) || 0) + 0.5;
      let hidden = 0;
      const head = card.querySelector("[data-card-head]");
      // Optional parts of a row (`data-fit-drop`, e.g. a delivery track) go first when their row crosses the bottom —
      // a lone row then still fits whole (R18 S5 G1: a small card on a computer with Linux font metrics).
      for (const el of card.querySelectorAll<HTMLElement>("[data-fit-drop]")) {
        const row = el.closest("button, li, a") ?? el.parentElement;
        if (!row || row.getBoundingClientRect().bottom <= limit) continue;
        el.style.display = "none";
        el.setAttribute("data-fit-hidden", "");
      }
      // A group (`data-fit-group`) is laid out as one block — its parts are not rows (lists inside it still are).
      const lists = [...card.querySelectorAll<HTMLElement>("*")].filter((p) => !head?.contains(p) && !p.hasAttribute("data-fit-group") && !p.closest("[data-fit-skip], [inert], [aria-hidden='true']") && p.children.length >= 2 && !(p instanceof SVGElement) && [...p.children].filter((c) => c.tagName === p.children[0].tagName).length >= 2);
      for (const list of lists) {
        const rows = [...list.children] as HTMLElement[];
        // Rows look alike: one tag, similar heights (a summary block over a list is not a list of two).
        const hs = rows.filter((r) => r.offsetParent !== null).map((r) => r.getBoundingClientRect().height).filter((x) => x > 0);
        if (rows.some((r) => r.tagName !== rows[0].tagName) || (hs.length >= 2 && Math.max(...hs) > Math.min(...hs) * 2.2)) continue;
        // Vertical lists only (a row of columns — a week strip — is not cut by column).
        const tops = rows.filter((r) => r.offsetParent !== null).map((r) => r.getBoundingClientRect().top);
        if (tops.length >= 2 && Math.abs(tops[1] - tops[0]) < 1) continue;
        const cut = rows.findIndex((r) => r.offsetParent !== null && r.getBoundingClientRect().bottom > limit);
        if (cut < 0) continue;
        // Keep the first row when the list is all there is (a lone row that doesn't fit is clamped below instead).
        const above = list.getBoundingClientRect().top - (head?.getBoundingClientRect().bottom ?? cr.top);
        for (const r of rows.slice(cut === 0 && above < 12 ? 1 : cut)) {
          if (r.style.display === "none") continue;
          r.style.display = "none";
          r.setAttribute("data-fit-hidden", "");
          if (!list.closest("[data-fit-nocount]")) hidden++;
        }
      }
      for (const p of card.querySelectorAll<HTMLElement>("p, [data-fit-text]")) {
        const r = p.getBoundingClientRect();
        if (!r.height || r.bottom <= limit || head?.contains(p)) continue;
        const lh = parseFloat(getComputedStyle(p).lineHeight) || 18;
        const lines = Math.max(1, Math.floor((limit - r.top) / lh));
        p.setAttribute("data-fit-clamp", "");
        p.style.display = "-webkit-box";
        p.style.overflow = "hidden";
        p.style.setProperty("-webkit-box-orient", "vertical");
        p.style.setProperty("-webkit-line-clamp", String(lines));
      }
      // A link / button under a clamped paragraph (an insight's action) that still crosses the bottom: fewer lines.
      for (const p of card.querySelectorAll<HTMLElement>("[data-fit-clamp]")) {
        let below = 0;
        for (let n = p.nextElementSibling; n; n = n.nextElementSibling) below = Math.max(below, n.getBoundingClientRect().bottom - limit);
        if (below <= 0) continue;
        const lh = parseFloat(getComputedStyle(p).lineHeight) || 18;
        const now = Number(p.style.getPropertyValue("-webkit-line-clamp")) || Math.round(p.getBoundingClientRect().height / lh);
        p.style.setProperty("-webkit-line-clamp", String(Math.max(1, now - Math.ceil(below / lh))));
      }
      for (const p of card.querySelectorAll<HTMLElement>("p")) {
        if (p.hasAttribute("data-fit-clamp") || head?.contains(p)) continue;
        let below = 0;
        for (let n = p.nextElementSibling; n; n = n.nextElementSibling) below = Math.max(below, n.getBoundingClientRect().bottom - limit);
        if (below <= 0) continue;
        const lh = parseFloat(getComputedStyle(p).lineHeight) || 18;
        const lines = Math.max(1, Math.round(p.getBoundingClientRect().height / lh) - Math.ceil(below / lh));
        p.setAttribute("data-fit-clamp", "");
        p.style.display = "-webkit-box";
        p.style.overflow = "hidden";
        p.style.setProperty("-webkit-box-orient", "vertical");
        p.style.setProperty("-webkit-line-clamp", String(lines));
      }
      card.setAttribute("data-more", String(Math.max(0, more) + hidden));
      // Tests wait for this before measuring (before hydration nothing is fitted yet).
      card.setAttribute("data-fitted", "");
    };
    fit();
    // Re-fit when the card or its body changes size, and once the web fonts are in (text reflows without either
    // box changing — R18 S5 G1: a slow CI run measured before the fonts and left a paragraph overflowing).
    const ro = new ResizeObserver(() => fit());
    ro.observe(card);
    for (const c of card.children) ro.observe(c);
    let live = true;
    void document.fonts?.ready.then(() => live && fit());
    return () => {
      live = false;
      ro.disconnect();
    };
  });
}

/** A Home widget's card: a header (icon, title, count/badge, link) over its body. Shared by the R13 sections and the
 *  R16 widgets (home-extra). `id` lands in data-home-section (status-strip jumps, tests); `more` (R17 A2) = how many
 *  of its items it isn't showing, in data-more. */
export function Card({ id, title, icon, count, badge, link, onLink, className, style, children, ai, more }: { id: string; title: string; icon?: React.ReactNode; count?: number; badge?: boolean; link?: string; onLink?: () => void; className?: string; style?: React.CSSProperties; children: React.ReactNode; ai?: boolean; more?: number }) {
  const ref = useRef<HTMLElement>(null);
  useFitRows(ref, more ?? 0);
  return (
    <section ref={ref} className={cn("r13-card r13-section flex min-w-0 flex-col", className)} style={style} data-home-section={id} data-more={Math.max(0, more ?? 0)} data-fit>
      <div data-card-head className="flex min-h-[42px] items-center gap-2 border-b border-line-in px-4 py-2 desk:min-h-[46px] desk:px-[18px] desk:py-2.5">
        {icon && <span className={cn("flex [&_svg]:size-4", ai ? "text-ai" : "text-ink")}>{icon}</span>}
        <h2 className={cn("text-[12px] font-bold uppercase tracking-[0.05em]", ai && "text-ai")} title={typeof title === "string" ? title : undefined}>{title}</h2>
        {count != null &&
          (badge ? (
            <span className="tabular rounded-full bg-warn px-[7px] text-[11px] font-bold leading-[18px] text-bg" data-home-count={id}>
              {count}
            </span>
          ) : (
            <span className="tabular text-[12px] text-muted">· {count}</span>
          ))}
        {link && (
          <button type="button" onClick={onLink} className="relative ms-auto flex items-center gap-0.5 text-[12.5px] font-medium text-muted transition hover:text-ink after:absolute after:-inset-3 after:content-['']" data-card-link={id}>
            {link}
            <ChevronRight className="size-3.5 rtl:-scale-x-100" />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
