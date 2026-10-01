import { cn } from "@/lib/utils";

/** Small progress ring (budget used, bought vs total). `value` 0..1; colours from CSS (default: --pc / surface-2). */
export function Ring({ value, size = 22, stroke = 4, color = "var(--pc, var(--brand))", track = "var(--surface-2)", className, children }: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden className="absolute inset-0 -rotate-90 rtl:scale-y-[-1]">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          className="transition-[stroke-dasharray] duration-[450ms] ease-[var(--ease-out)]"
        />
      </svg>
      {children && <span className="relative">{children}</span>}
    </span>
  );
}
