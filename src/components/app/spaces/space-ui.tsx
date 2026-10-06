"use client";

import { useCallback } from "react";
import { switchSpace } from "@/app/space-actions";
import { loadAppData } from "@/app/data-actions";
import { toast } from "@/lib/toast";
import { useI18n } from "@/components/providers";
import { useDataStore, useStore } from "../store";
import { cn } from "@/lib/utils";
import type { Person } from "@/lib/types";

// R15 C1 — space identity and people, as in the r15 mockups: a rounded tile in the space colour with its initial,
// gradient-free initial avatars (6 colours, picked from the user id), facepiles. The realtime presence layer is R16:
// `online` is accepted so it only has to feed data.

export { avatarColor, TILE, tileColor } from "./colors";
import { avatarColor, tileColor } from "./colors";

const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

export function SpaceTile({ name, color, size = 28, className }: { name: string; color: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center font-bold text-white", className)}
      style={{ width: size, height: size, borderRadius: Math.round(size / 4), background: tileColor(color), fontSize: Math.round(size * 0.46) }}
      data-space-tile
    >
      {initial(name)}
    </span>
  );
}

export function Avatar({ person, size = 24, online, className, title }: { person: Person; size?: number; online?: boolean; className?: string; title?: string }) {
  return (
    <span
      className={cn("relative grid shrink-0 place-items-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, background: avatarColor(person.id), fontSize: Math.max(9, Math.round(size * 0.45)) }}
      title={title ?? person.name}
      aria-label={title ?? person.name}
      role="img"
      data-avatar
    >
      {initial(person.name)}
      {online && <span className="absolute -bottom-px -end-px size-2.5 rounded-full bg-[#22c55e] ring-2 ring-raised" />}
    </span>
  );
}

/** R16 B4: `online` = people present in this space now (green dot; they come first). */
export function Facepile({ people, size = 22, max = 3, online }: { people: Person[]; size?: number; max?: number; online?: Set<string> }) {
  const list = online?.size ? [...people.filter((p) => online.has(p.id)), ...people.filter((p) => !online.has(p.id))] : people;
  return (
    <span className="flex" aria-hidden data-facepile>
      {list.slice(0, max).map((p, i) => (
        <Avatar key={p.id} person={p} size={size} online={online?.has(p.id)} className={cn("ring-2 ring-raised", i > 0 && "-ms-1.5")} />
      ))}
    </span>
  );
}

/**
 * R16 B4: who else is in the current space right now (Ably presence; empty while polling) and who of them is in
 * shopping mode — never yourself.
 */
export function usePresence() {
  const s = useStore();
  const me = s.me?.id;
  const online = new Set([...s.present.keys()].filter((id) => id !== me));
  const shopping = [...s.present.entries()].filter(([id, m]) => id !== me && m === "shopping").map(([id]) => s.people.find((p) => p.id === id)).filter((p): p is Person => !!p);
  return { online, shopping };
}

/** "Noa is shopping" — a small live chip (nothing when nobody is). */
export function ShoppingNow({ className }: { className?: string }) {
  const { shopping } = usePresence();
  const { f, t } = useI18n();
  if (!shopping.length) return null;
  const first = shopping[0].name.split(/\s+/)[0];
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,#22c55e_14%,transparent)] px-2 py-0.5 text-[11.5px] font-semibold text-[#15803d] dark:text-[#4ade80]", className)} data-shopping-now>
      <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[#22c55e] motion-reduce:animate-none" aria-hidden />
      <span className="truncate">{f(t.live.shopping, { name: shopping.length > 1 ? `${first} +${shopping.length - 1}` : first })}</span>
    </span>
  );
}

// ---- one place that opens the space dialogs (mounted once: SpacesLayer) ----

export type SpaceDialog = { kind: "create" } | { kind: "invite" } | { kind: "settings" } | { kind: "move"; collectionId: string };
const EVENT = "nexus:spaces";
export function openSpaces(d: SpaceDialog) {
  window.dispatchEvent(new CustomEvent<SpaceDialog>(EVENT, { detail: d }));
}
export function onOpenSpaces(fn: (d: SpaceDialog) => void) {
  const h = (e: Event) => fn((e as CustomEvent<SpaceDialog>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** After a switch the page reloads in the same view; this flag shows "Now in …" once it's back. */
export const NOW_IN_KEY = "nexus.nowIn";

/** Reload into the current space (cookie set by the action), keeping the view (?v=) and showing a toast after. */
export function reloadInto(name: string | null) {
  try {
    if (name) sessionStorage.setItem(NOW_IN_KEY, name);
  } catch {
    /* private mode */
  }
  const u = new URL(window.location.href);
  u.searchParams.delete("item");
  window.location.replace(u.toString());
}

/**
 * R16 A12: switch without a page reload — the action sets the cookie, then the new space's data (the same loader as the
 * first render) replaces the store's; shell and sidebar stay mounted; lands on Home with "Now in …".
 */
export function useSwitchSpace() {
  const s = useStore();
  const { f, t } = useI18n();
  const { replaceData } = s;
  return useCallback(
    async (id: string) => {
      const r = await switchSpace(id);
      try {
        replaceData(await loadAppData());
      } catch {
        return reloadInto(r.name);
      }
      toast(f(t.spaces.now, { space: r.name }), { duration: 2600 });
    },
    [replaceData, f, t],
  );
}

/** The signed-in person's display name (first name), for greetings and the account rows. */
export function useMeName() {
  const s = useStore();
  const { t } = useI18n();
  const n = (s.me?.name || s.me?.email.split("@")[0] || "").trim().split(/\s+/)[0];
  return n || t.shell.owner;
}

/** C4: who added an item — a small avatar on rows/cards in shared spaces only (tooltip = the name). */
export function AddedBy({ userId, size = 16, className }: { userId: string | null | undefined; size?: number; className?: string }) {
  const s = useDataStore();
  const { t, f } = useI18n();
  if (!userId || s.space?.kind !== "shared") return null;
  const p = s.people.find((x) => x.id === userId);
  if (!p) return null;
  return <Avatar person={p} size={size} className={cn("ring-2 ring-surface", className)} title={f(t.spaces.addedBy, { name: p.name })} />;
}
