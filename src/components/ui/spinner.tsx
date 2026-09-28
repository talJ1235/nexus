import { cn } from "@/lib/utils";

/**
 * The one loading indicator used everywhere: a thin ring with a soft comet tail that turns slowly.
 * Pure CSS (a masked conic gradient rotated with `transform`), so it stays smooth on the compositor even
 * while the main thread is busy. Inherits the text colour; size with `size-*`.
 */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return <span role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn("spinner size-4", className)} />;
}

/** "Thinking" indicator for AI answers: three dots that rise and fade in a slow wave. */
export function ThinkingDots({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("thinking-dots", className)}>
      <span />
      <span />
      <span />
    </span>
  );
}
