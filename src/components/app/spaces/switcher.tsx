"use client";

import { Check, ChevronsUpDown, LogOut, Plus, Settings, UserPlus } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";
import type { SpaceCard } from "@/lib/types";
import { useStore } from "../store";
import { Facepile, openSpaces, ShoppingNow, SpaceTile, usePresence, useSwitchSpace } from "./space-ui";

const isMac = () => typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform);

/** "Shared · 3 people" / "Personal" / role, under a space's name. */
export function useSpaceSub() {
  const { t, f } = useI18n();
  return (sp: Pick<SpaceCard, "kind" | "count" | "role">, withRole = false) => {
    const base = sp.kind === "personal" ? t.spaces.personal : sp.count > 1 ? f(t.spaces.sharedN, { n: sp.count }) : t.spaces.shared;
    return withRole && sp.kind === "shared" ? `${base} · ${t.spaces.roles[sp.role]}` : base;
  };
}

/** Desktop: the switch button under the logo (Switcher-desktop) and its menu. Collapsed sidebar → the tile only. */
export function SpaceSwitcher({ collapsed }: { collapsed?: boolean }) {
  const s = useStore();
  const { t, f } = useI18n();
  const sub = useSpaceSub();
  const go = useSwitchSpace();
  const presence = usePresence();
  const cur = s.spaces.find((x) => x.id === s.space?.id);
  if (!s.space || !cur) return null;
  const mod = isMac() ? "⌘" : "Ctrl+";
  const canInvite = cur.kind === "shared" && cur.role !== "viewer";
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`${t.spaces.switch}: ${cur.name}`}
          title={collapsed ? cur.name : undefined}
          className={cn(
            "flex h-11 w-full shrink-0 items-center gap-2.5 rounded-lg px-2 text-start transition hover:bg-surface-2 data-[state=open]:bg-[var(--nav-active)]",
            collapsed && "justify-center px-0",
          )}
          data-space-switcher
          data-space-id={cur.id}
        >
          <SpaceTile name={cur.name} color={cur.color} size={28} />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 leading-tight">
                <b className="block truncate text-[14px] font-semibold">{cur.name}</b>
                {presence.shopping.length ? <ShoppingNow className="mt-0.5 max-w-full" /> : <span className="block truncate text-[11.5px] text-muted">{sub(cur, true)}</span>}
              </span>
              {cur.kind === "shared" && cur.faces.length > 1 && <Facepile people={cur.faces} size={20} online={presence.online} />}
              <ChevronsUpDown className="size-4 shrink-0 text-muted" />
            </>
          )}
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-[300px]">
        {s.me && <MenuLabel>{s.me.email}</MenuLabel>}
        {s.spaces.map((sp, i) => (
          <MenuItem key={sp.id} onSelect={() => sp.id !== cur.id && void go(sp.id)} className="h-auto min-h-11 py-1.5" data-space-item={sp.id}>
            <SpaceTile name={sp.name} color={sp.color} size={22} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className={cn("block truncate", sp.id === cur.id && "font-semibold")}>{sp.name}</span>
              <span className="block truncate text-[11.5px] text-muted">{sp.kind === "personal" ? t.spaces.personal : t.spaces.roles[sp.role]}</span>
            </span>
            {sp.kind === "shared" && sp.faces.length > 1 && <Facepile people={sp.faces} size={18} />}
            {sp.id === cur.id && <Check className="!text-ink" />}
            {i < 9 && <span className="text-[11px] tabular-nums text-faint">{mod}{i + 1}</span>}
          </MenuItem>
        ))}
        <MenuItem onSelect={() => openSpaces({ kind: "create" })} data-space-create>
          <Plus />
          {t.spaces.create}
        </MenuItem>
        <MenuSeparator />
        {canInvite && (
          <MenuItem onSelect={() => openSpaces({ kind: "invite" })} data-space-invite>
            <UserPlus />
            {f(t.spaces.inviteTo, { space: cur.name })}
          </MenuItem>
        )}
        <MenuItem onSelect={() => openSpaces({ kind: "settings" })} data-space-settings>
          <Settings />
          {t.spaces.settings}
        </MenuItem>
        <MenuSeparator />
        <form action="/api/logout" method="post">
          <MenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut />
              {t.spaces.logOut}
            </button>
          </MenuItem>
        </form>
      </MenuContent>
    </Menu>
  );
}

/** Phone (Switcher-phone): the space rows + actions, at the top of the Me sheet. `close` runs before acting. */
export function SpaceRows({ close }: { close: (fn: () => void) => () => void }) {
  const s = useStore();
  const { t, f } = useI18n();
  const sub = useSpaceSub();
  const go = useSwitchSpace();
  const presence = usePresence();
  const cur = s.spaces.find((x) => x.id === s.space?.id);
  if (!cur) return null;
  const row = "flex min-h-[56px] w-full items-center gap-3 rounded-[16px] px-3 text-start text-[15px] transition active:bg-surface-2 hover:bg-surface-2";
  return (
    <section className="space-y-0.5" data-space-rows>
      <h3 className="px-3 pb-1 text-[12.5px] font-bold uppercase tracking-wide text-muted">{t.spaces.title}</h3>
      {s.spaces.map((sp) => (
        <button
          key={sp.id}
          type="button"
          className={cn(row, sp.id === cur.id && "bg-[var(--nav-active)]")}
          onClick={sp.id === cur.id ? undefined : close(() => void go(sp.id))}
          aria-current={sp.id === cur.id ? "true" : undefined}
          data-space-item={sp.id}
        >
          <SpaceTile name={sp.name} color={sp.color} size={32} />
          <span className="min-w-0 flex-1 leading-tight">
            <span className={cn("block truncate", sp.id === cur.id ? "font-bold" : "font-semibold")}>{sp.name}</span>
            {sp.id === cur.id && presence.shopping.length ? <ShoppingNow className="mt-0.5 max-w-full" /> : <span className="block truncate text-[12.5px] text-muted">{sub(sp, true)}</span>}
          </span>
          {sp.kind === "shared" && sp.faces.length > 1 && <Facepile people={sp.faces} size={20} online={sp.id === cur.id ? presence.online : undefined} />}
          {sp.id === cur.id && <Check className="size-5 shrink-0" />}
        </button>
      ))}
      <button type="button" className={cn(row, "font-semibold [&>svg]:mx-[6px] [&>svg]:size-5 [&>svg]:text-muted")} onClick={close(() => openSpaces({ kind: "create" }))} data-space-create>
        <Plus /> {t.spaces.create}
      </button>
      {cur.kind === "shared" && cur.role !== "viewer" && (
        <button type="button" className={cn(row, "font-semibold [&>svg]:mx-[6px] [&>svg]:size-5 [&>svg]:text-muted")} onClick={close(() => openSpaces({ kind: "invite" }))} data-space-invite>
          <UserPlus /> {f(t.spaces.inviteTo, { space: cur.name })}
        </button>
      )}
      <button type="button" className={cn(row, "font-semibold [&>svg]:mx-[6px] [&>svg]:size-5 [&>svg]:text-muted")} onClick={close(() => openSpaces({ kind: "settings" }))} data-space-settings>
        <Settings /> {t.spaces.settings}
      </button>
    </section>
  );
}
