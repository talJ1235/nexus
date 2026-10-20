// R19 — money everywhere in the price screens: the ₪ sign smaller than the digits (.66 em), tabular digits, the amount
// isolated left-to-right so it reads the same inside Hebrew (`.money` in sm.css; board nx-r19.css `.cur`).
import { cn } from "@/lib/utils";

export function money(v: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

export function Money({ v, className, strike }: { v: number | null | undefined; className?: string; strike?: boolean }) {
  if (v == null || !Number.isFinite(v)) return null;
  return (
    <span className={cn("money", strike && "money-was", className)} data-money={v.toFixed(2)}>
      <span className="cur">₪</span>
      {money(v)}
    </span>
  );
}
