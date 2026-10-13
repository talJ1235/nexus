"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { ART, SECTION_COLOR, SECTION_PATHS } from "./art-data";

// R18 S2 — product picture tiles and section icons (boards' `.pt` and `.si`). Section colours are always on (Tal
// 2026-10-13: no switch). The tile is the section's tint with the product type's illustration, a real photo only when
// the exact product is known (own photo / barcode picture), else the section icon.

export const sectionColor = (section: string | null | undefined) => SECTION_COLOR[section ?? "other"] ?? SECTION_COLOR.other;

export function SectionGlyph({ section, className }: { section: string | null | undefined; className?: string }) {
  const d = SECTION_PATHS[section ?? ""] ?? "M5 8h14l-1 12H6z M9 8V6a3 3 0 0 1 6 0v2";
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** The section's icon tile (section headers, the store chip's rail). */
export function SectionIcon({ section, size = 32 }: { section: string | null | undefined; size?: number }) {
  return (
    <span className="gro-si" style={{ "--k": sectionColor(section), width: size, height: size } as React.CSSProperties} aria-hidden>
      <SectionGlyph section={section} className="size-[56%]" />
    </span>
  );
}

/** A product's picture tile: photo → illustration → section icon, on the section's tint. */
export const ProductTile = memo(function ProductTile({ art, section, photo, size = 48, className, got }: { art?: string | null; section?: string | null; photo?: string | null; size?: number; className?: string; got?: boolean }) {
  const layers = art ? ART[art] : undefined;
  return (
    <span className={cn("gro-pt", got && "gro-got", className)} style={{ "--k": sectionColor(section), width: size, height: size } as React.CSSProperties} aria-hidden data-art={art ?? undefined}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- a stored product photo, any size
        <img src={photo} alt="" className="size-full object-cover" loading="lazy" decoding="async" />
      ) : layers ? (
        <svg viewBox="0 0 48 48" className="gro-art">
          {layers.map(([d, fill], i) => (
            <path key={i} d={d} fill={fill} />
          ))}
        </svg>
      ) : (
        <SectionGlyph section={section} className="gro-glyph" />
      )}
    </span>
  );
});
