"use client";

import { Children, isValidElement } from "react";
import { cn } from "@/lib/utils";
import { PersonPhoto } from "../person-photo";
import { initialOf } from "@/lib/initial";

// R16 D1–D3: small pieces of the settings shell in the boards' kit (.nx, components/auth/nx.css + ./nx16.css).

/** The boards' line icons (24-grid paths, stroked). */
export const P = {
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4.5 20.5c1.3-3.3 4-5 7.5-5s6.2 1.7 7.5 5",
  account: "M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M8.5 16.5c.8-1.6 2-2.4 3.5-2.4s2.7.8 3.5 2.4",
  display: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4 M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  notif: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.9 1.9 0 0 0 3.4 0",
  ai: "M12 3l1.8 4.9L19 9.5l-5.2 1.6L12 16l-1.8-4.9L5 9.5l5.2-1.6z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
  calendar: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M3 10h18 M8 2v4 M16 2v4",
  memory: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h11 M9 8h6",
  data: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  general: "M4 6h10 M18 6h2 M4 12h4 M12 12h8 M4 18h12 M16 4v4 M10 10v4 M18 16v4",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8",
  budget: "M3 7a2 2 0 0 1 2-2h13v4 M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z M16 14.5h.01",
  danger: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01",
  flag: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7",
  signOut: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  close: "M18 6 6 18M6 6l12 12",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z m9 2-3.5-3.5",
  chevron: "m9 18 6-6-6-6",
  back: "m15 18-6-6 6-6",
  down: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
  check: "M20 6 9 17l-5-5",
  phone: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M11 18h2",
  desktop: "M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M8 21h8M12 17v4",
  tablet: "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M11 18h2",
  box: "M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z M3 9l2-5h14l2 5 M10 13h4",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5 M12 7v5l3 2",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2 M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z",
  trendDown: "M22 17l-8.5-8.5-5 5L2 7 M16 17h6v-6",
  truck: "M3 7h12v10H3z M15 10h4l2 3v4h-6 M7 19.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z M18 19.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z",
  tag: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z M7.5 7.5h.01",
  screen: "M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M14 9h5 M14 13h3",
  picture: "M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z m12 4-5-5L5 21",
  lines: "M4 6h16 M4 12h10 M4 18h6",
  coin: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9 8h4a3 3 0 0 1 0 6h-3v3 M9 8v9",
  motion: "M5 12h14 M12 5l7 7-7 7",
  copy: "M11 9h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z M5 15V5a2 2 0 0 1 2-2h10",
  download: "M12 3v12 M7 10l5 5 5-5 M4 19h16",
  upload: "M12 21V9 M7 14l5-5 5 5 M4 5h16",
  sheet: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M3 9h18 M3 15h18 M9 3v18",
  receipt: "M6 2h9l5 5v15H6z M14 2v6h6 M9 14h6 M9 18h4",
  table: "M4 4h16v16H4z M4 9h16 M9 9v11",
  trash: "M3 6h18 M8 6V4h8v2 M6 6l1 14h10l1-14",
  pencil: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  swap: "M7 7h13 M16 3l4 4-4 4 M17 17H4 M8 21l-4-4 4-4",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.9 1.9 0 0 0 3.4 0",
  userPlus: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M19 8v6 M22 11h-6",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z m18 2-10 7L2 6",
  refresh: "M21 12a9 9 0 1 1-3-6.7L21 8 M21 3v5h-5",
  google: "",
} as const;

export function I({ d, className, size }: { d: string; className?: string; size?: "sm" | "lg" | "xl" }) {
  return (
    <svg className={cn("i", size, className)} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function Toggle({ on, onChange, label, disabled, ...rest }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean } & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={cn("tgl", on && "on")} onClick={() => onChange(!on)} {...rest} />
  );
}

export function Seg<T extends string>({ value, options, onChange, label, large, block }: { value: T; options: { value: T; label: React.ReactNode; lang?: string }[]; onChange: (v: T) => void; label: string; large?: boolean; block?: boolean }) {
  return (
    <div className={cn("seg", large && "lg")} role="radiogroup" aria-label={label} style={block ? { width: "100%" } : undefined}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} lang={o.lang} className={cn(value === o.value && "on")} style={block ? { flex: 1, justifyContent: "center" } : undefined} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tick() {
  return (
    <span className="tick" aria-hidden>
      <svg viewBox="0 0 24 24">
        <path d={P.check} />
      </svg>
    </span>
  );
}

/** A row in a card list (`.li`): icon, title + sub, trailing control. */
/** Polish #3: a tap anywhere on a row that holds a switch flips it (the 36 × 20 switch alone is too small a target);
 *  taps on the row's other controls (a select, a button) stay theirs. The switch stays the keyboard / screen-reader target. */
function tapRowSwitch(e: React.MouseEvent<HTMLDivElement>) {
  if ((e.target as Element).closest("button, a, select, input, textarea, label")) return;
  e.currentTarget.querySelector<HTMLButtonElement>('[role="switch"]:not(:disabled)')?.click();
}

export function Li({ icon, tone, title, sub, children, className, ...rest }: { icon?: React.ReactNode; tone?: "ok" | "warn" | "info" | "dng"; title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode; className?: string } & Record<`data-${string}`, string | boolean | undefined>) {
  const sw = Children.toArray(children).some((c) => isValidElement(c) && c.type === Toggle);
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a larger pointer target for the switch inside, which keeps its own keyboard handling
    <div className={cn("li", sw && "li-sw", className)} onClick={sw ? tapRowSwitch : undefined} {...rest}>
      {icon != null && <span className={cn("ic", tone)}>{typeof icon === "string" ? <I d={icon} /> : icon}</span>}
      <span className="grow">
        <b>{title}</b>
        {sub != null && (
          <>
            <br />
            <span className="tiny">{sub}</span>
          </>
        )}
      </span>
      {children}
    </div>
  );
}

/** A native select in the board's `.sel` look (keyboard + screen readers for free). */
export function Sel<T extends string>({ value, options, onChange, label, disabled, ...rest }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; disabled?: boolean } & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <select className="nsel" value={value} aria-label={label} disabled={disabled} onChange={(e) => onChange(e.target.value as T)} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SectionHead({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="sx-h">
      <h1>{title}</h1>
      {children}
    </div>
  );
}

/** Avatar in the kit (`.av`), colour from the same palette as the app's avatars. */
export function Av({ name, color, size, online, image }: { name: string; color: string; size?: "xs" | "sm" | "lg" | "xl"; online?: boolean; image?: string | null }) {
  return (
    <span className={cn("av", size)} style={{ background: color }} aria-hidden>
      <PersonPhoto url={image} fallback={initialOf(name)} />
      {online && <span className="on" />}
    </span>
  );
}
