import { cn } from "@/lib/utils";

/** Nexus mark: three nodes linked to a hub; the hub is the amber "price tag" dot. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" className="fill-fg" />
      <g className="stroke-bg" strokeWidth="2.2" strokeLinecap="round">
        <path d="M16 16 9 9M16 16l7-7M16 16v8.5" />
      </g>
      <circle cx="9" cy="9" r="2.6" className="fill-bg" />
      <circle cx="23" cy="9" r="2.6" className="fill-bg" />
      <circle cx="16" cy="24.5" r="2.6" className="fill-bg" />
      <circle cx="16" cy="16" r="4" className="fill-accent" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-[-0.01em]">Nexus</span>
    </span>
  );
}
