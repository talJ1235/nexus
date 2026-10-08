import { cn } from "@/lib/utils";

/** The left face's thin edge (R14 B6, Graphite: the face follows the theme, so it needs an outline; Plum: none).
 *  Paint the left face first: the top and right faces then cover the inner half of its edge. */
export const LOGO_EDGE = { stroke: "var(--logo-edge)", strokeWidth: 1.2, strokeLinejoin: "round" } as const;

/** Nexus "Box" mark: an open-box cube from three faces. Colours come from CSS vars (--logo-c1..3, globals.css), so it
 *  follows the palette and mode. `onBrand`: drawn on a brand-coloured pill, where the left face uses --on-brand. */
export function LogoMark({ className, onBrand }: { className?: string; onBrand?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-7 shrink-0", className)} aria-hidden="true">
      <path d="M10 20l22 12v24L10 44z" fill={onBrand ? "var(--on-brand)" : "var(--logo-c1)"} {...(!onBrand && LOGO_EDGE)} />
      <path d="M32 8 54 20 32 32 10 20z" fill="var(--logo-c3)" />
      <path d="M54 20 32 32v24l22-12z" fill="var(--logo-c2)" />
    </svg>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className={markClassName} />
      <span className="text-[19px] font-extrabold tracking-[-0.02em]">Nexus</span>
    </span>
  );
}

/** Logo pill (brand background) used at the top of the sidebar and the phone top bar. */
export function LogoPill({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-12 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-full bg-brand ps-2.5 text-on-brand",
        collapsed ? "w-12 pe-2.5" : "pe-4",
        className,
      )}
    >
      <LogoMark onBrand className="size-[30px]" />
      <span className={cn("text-[19px] font-extrabold tracking-[-0.02em] transition-opacity duration-200", collapsed && "opacity-0")}>Nexus</span>
    </span>
  );
}
