"use client";

import { cn } from "@/lib/utils";
import { gradientOf, isSpacePhoto, SPACE_ICONS } from "./look";
import { initialOf } from "@/lib/initial";

const initial = (name: string) => initialOf(name);

/**
 * The space tile (R16 D5, board SpaceIdentity): its photo, or its icon on the colour's gradient (the initial when it
 * has no icon). Radius ≈ ¼ of the size, as the boards (22 → 6, 40 → 10, 120 → 30).
 */
export function SpaceTile({ name, color, icon, photo, size = 28, className, style }: { name: string; color: string; icon?: string | null; photo?: string | null; size?: number; className?: string; style?: React.CSSProperties }) {
  const d = icon ? SPACE_ICONS[icon] : null;
  // Stored photos are checked; a local blob: URL is the identity editor's live crop preview.
  const pic = photo && (photo.startsWith("blob:") || isSpacePhoto(photo)) ? photo : null;
  return (
    <span
      aria-hidden
      className={cn("relative grid shrink-0 place-items-center overflow-hidden font-bold text-white", className)}
      style={{ width: size, height: size, borderRadius: Math.round(size / 4), background: gradientOf(color), fontSize: Math.round(size * 0.46), boxShadow: "inset 0 0 0 1px rgba(255,255,255,.18)", ...style }}
      data-space-tile
      data-space-photo={pic ? "" : undefined}
    >
      {pic ? (
        // eslint-disable-next-line @next/next/no-img-element -- our own 512 px WebP (Blob), any size
        <img src={pic} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
      ) : d ? (
        <svg viewBox="0 0 24 24" width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} fill="none" stroke="currentColor" strokeWidth={size >= 100 ? 1.6 : 1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d={d} />
        </svg>
      ) : (
        initial(name)
      )}
    </span>
  );
}
