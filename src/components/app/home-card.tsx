"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** A Home widget's card: a header (icon, title, count/badge, link) over its body. Shared by the R13 sections and the
 *  R16 widgets (home-extra). `id` lands in data-home-section (status-strip jumps, tests). */
export function Card({ id, title, icon, count, badge, link, onLink, className, style, children, ai }: { id: string; title: string; icon?: React.ReactNode; count?: number; badge?: boolean; link?: string; onLink?: () => void; className?: string; style?: React.CSSProperties; children: React.ReactNode; ai?: boolean }) {
  return (
    <section className={cn("r13-card r13-section flex min-w-0 flex-col", className)} style={style} data-home-section={id}>
      <div data-card-head className="flex min-h-[42px] items-center gap-2 border-b border-line-in px-4 py-2 lg:min-h-[46px] lg:px-[18px] lg:py-2.5">
        {icon && <span className={cn("flex [&_svg]:size-4", ai ? "text-ai" : "text-ink")}>{icon}</span>}
        <h2 className={cn("text-[12px] font-bold uppercase tracking-[0.05em]", ai && "text-ai")}>{title}</h2>
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
