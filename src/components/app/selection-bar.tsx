"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Check, Flag, ListPlus, PackageCheck, Search, ShoppingCart, Split, Trash2, Truck, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { bulkDelete, bulkSetStatus, bulkUpdate, createAltGroup, createCollection, restoreItems } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { Button, Input } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger, Pop, PopContent, PopTrigger } from "@/components/ui/overlays";
import { activeSource } from "@/lib/calc";
import { cn } from "@/lib/utils";
import { optimisticStatus, type Status } from "./item-card";
import { useStore } from "./store";
import { COLLECTION_COLORS, useViewItems } from "./view-items";

export function SelectionBar() {
  const s = useStore();
  const { t, f } = useI18n();
  const visible = useViewItems();
  const [altName, setAltName] = useState("");
  // R16 A5: one menu/popover open at a time across the bar (Move to, Priority, Compare) — a single controlled state.
  const [openMenu, setOpenMenu] = useState<"move" | "priority" | "compare" | null>(null);
  const menuProps = (k: "move" | "priority" | "compare") => ({ open: openMenu === k, onOpenChange: (o: boolean) => setOpenMenu((cur) => (o ? k : cur === k ? null : cur)) });
  // Closing one because another opened: don't hand focus back to its trigger (that would close the new one at once).
  const keepFocus = (k: string) => (e: Event) => {
    if (openMenu && openMenu !== k) e.preventDefault();
  };
  const ids = [...s.selected];
  // Other fixed bars step aside while items are selected (an attribute on <html>, cheaper than a :has() selector).
  const selecting = s.selected.size > 0;
  useEffect(() => {
    if (!selecting) return;
    document.documentElement.dataset.selecting = "";
    return () => {
      delete document.documentElement.dataset.selecting;
    };
  }, [selecting]);
  const chosen = s.items.filter((i) => s.selected.has(i.id));
  const n = ids.length;
  if (!n || s.readOnly) return null;

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      toast.error(t.errors.generic);
    }
  };

  const setPatch = (patch: { collectionId?: string | null; priority?: "urgent" | "normal" | "someday" }, newName?: string) =>
    run(async () => {
      s.upsertItems(chosen.map((i) => ({ ...i, ...patch })));
      const req = bulkUpdate(ids, patch);
      let id: string | number | undefined;
      if (patch.collectionId !== undefined) {
        const name = patch.collectionId ? (newName ?? s.collections.find((c) => c.id === patch.collectionId)?.name ?? "") : t.home.noProject;
        // Undo puts every item back in the project it came from (R14 B4: same as a drag onto a project / No project).
        const before = chosen.map((i) => ({ ...i }));
        id = toast.success(f(t.select.moved, { name }), {
          description: f(t.collection.itemsCount, { n }),
          action: {
            label: t.item.undo,
            onClick: async () => {
              s.upsertItems(before);
              await req.catch(() => null);
              const byColl = new Map<string | null, string[]>();
              for (const i of before) byColl.set(i.collectionId, [...(byColl.get(i.collectionId) ?? []), i.id]);
              for (const [c, list] of byColl) await bulkUpdate(list, { collectionId: c }).catch(() => null);
            },
          },
        });
      }
      s.clearSelection();
      try {
        s.upsertItems(await req);
      } catch (e) {
        s.upsertItems(chosen);
        if (id != null) toast.dismiss(id);
        throw e;
      }
    });

  const setStatusAll = (status: Status) =>
    run(async () => {
      const entries = chosen.map((i) => {
        const src = activeSource(i, s.rates);
        const paid = status !== "to_buy" && i.status === "to_buy" && src?.price != null ? { price: src.price + (src.shipping ?? 0), currency: src.currency } : null;
        return { item: i, paid };
      });
      s.upsertItems(entries.map((e) => optimisticStatus(e.item, status, e.paid)));
      s.upsertItems(await bulkSetStatus(entries.map((e) => ({ id: e.item.id, paid: e.paid })), status));
      s.clearSelection();
    });

  const remove = () =>
    run(async () => {
      s.removeItems(ids);
      const req = bulkDelete(ids);
      const id = toast(f(t.select.deleted, { n }), {
        action: { label: t.item.undo, onClick: async () => s.upsertItems(await restoreItems(await req)) },
      });
      try {
        await req;
      } catch (e) {
        s.upsertItems(chosen);
        toast.dismiss(id);
        throw e;
      }
    });

  const compare = () =>
    run(async () => {
      const name = altName.trim() || chosen[0]?.title.slice(0, 60) || t.alt.title;
      const res = await createAltGroup(ids, name);
      s.setItems(res.items);
      s.setAltGroups(res.altGroups);
      setOpenMenu(null);
      setAltName("");
      s.clearSelection();
      toast.success(t.alt.created, { action: { label: t.alt.open, onClick: () => s.openAlt(res.groupId) } });
    });

  const canCompare = n >= 2 && chosen.every((i) => i.status === "to_buy");
  const collections = s.collections.filter((c) => !c.archived);

  const newList = (name: string) =>
    run(async () => {
      const c = await createCollection({ kind: "list", name });
      s.upsertCollection(c);
      await setPatch({ collectionId: c.id }, c.name);
    });

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-3 lg:ps-[calc(var(--sw,224px)+12px)]" role="toolbar" data-selection-bar aria-label={f(t.select.selected, { n })}>
      <div className="pointer-events-auto flex max-w-full animate-pop-in items-center gap-1 overflow-x-auto rounded-2xl border border-line bg-raised p-1.5 shadow-pop">
        <Button size="icon-sm" variant="ghost" onClick={s.clearSelection} aria-label={t.select.clear} title={t.select.clear}>
          <X />
        </Button>
        <span className="tabular whitespace-nowrap px-1.5 text-sm font-semibold">{f(t.select.selected, { n })}</span>
        {n < visible.length && (
          <button type="button" onClick={() => s.setSelected(visible.map((i) => i.id))} className="whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-accent-ink hover:bg-accent-soft">
            {t.select.selectAll}
          </button>
        )}
        <span className="mx-1 h-6 w-px shrink-0 bg-line" aria-hidden />

        <Pop {...menuProps("move")}>
          <PopTrigger asChild>
            <Button size="sm" variant="ghost" className="text-fg" title={`${t.select.moveTo} · M`} data-select-menu="move">
              <ArrowRightLeft />
              <span className="max-sm:hidden">{t.select.moveTo}</span>
            </Button>
          </PopTrigger>
          <PopContent align="center" className="w-[min(320px,calc(100vw-24px))] p-1.5" onCloseAutoFocus={keepFocus("move")}>
            <MovePanel
              chosen={chosen}
              collections={collections}
              onStatus={(st) => {
                setOpenMenu(null);
                void setStatusAll(st);
              }}
              onMove={(id) => {
                setOpenMenu(null);
                void setPatch({ collectionId: id });
              }}
              onNewList={(name) => {
                setOpenMenu(null);
                void newList(name);
              }}
            />
          </PopContent>
        </Pop>

        <Menu modal={false} {...menuProps("priority")}>
          <MenuTrigger asChild>
            <Button size="sm" variant="ghost" className="text-fg" data-select-menu="priority">
              <Flag />
              <span className="max-sm:hidden">{t.item.priority}</span>
            </Button>
          </MenuTrigger>
          <MenuContent align="center" onCloseAutoFocus={keepFocus("priority")}>
            {(["urgent", "normal", "someday"] as const).map((p) => (
              <MenuItem key={p} onSelect={() => void setPatch({ priority: p })}>
                {t.item[p]}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>

        {canCompare && (
          <Pop {...menuProps("compare")}>
            <PopTrigger asChild>
              <Button size="sm" variant="ghost" className="text-accent-ink" data-select-menu="compare">
                <Split />
                <span className="max-sm:hidden">{t.select.compare}</span>
              </Button>
            </PopTrigger>
            <PopContent align="center" className="w-72" onCloseAutoFocus={keepFocus("compare")}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void compare();
                }}
              >
                <label htmlFor="alt-name" className="text-sm font-medium">
                  {t.alt.namePrompt}
                </label>
                <Input id="alt-name" autoFocus value={altName} onChange={(e) => setAltName(e.target.value)} placeholder={t.alt.namePlaceholder} className="mt-2 h-9 bidi"  />
                <p className="mt-2 text-xs leading-relaxed text-muted">{t.alt.hint}</p>
                <Button type="submit" size="sm" variant="accent" className="mt-3 w-full">
                  {t.alt.create}
                </Button>
              </form>
            </PopContent>
          </Pop>
        )}

        <Button size="sm" variant="ghost" onClick={() => void remove()} title={`${t.select.delete} · Del`} className="text-danger hover:bg-danger-soft hover:text-danger">
          <Trash2 />
          <span className="max-sm:hidden">{t.select.delete}</span>
        </Button>
      </div>
    </div>
  );
}

type Coll = ReturnType<typeof useStore>["collections"][number];

/**
 * R16 A4 — "Move to": status first, then this space's lists & projects (search when > 8), "Remove from…" only when a
 * selected item is in one, and "New list…" (creates it and moves the items in one step). Never a lone "Remove".
 */
function MovePanel({ chosen, collections, onStatus, onMove, onNewList }: { chosen: { status: Status; collectionId: string | null }[]; collections: Coll[]; onStatus: (s: Status) => void; onMove: (id: string | null) => void; onNewList: (name: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const allIn = (st: Status) => chosen.every((i) => i.status === st);
  const inSome = chosen.some((i) => i.collectionId);
  const query = q.trim().toLowerCase();
  const shown = query ? collections.filter((c) => c.name.toLowerCase().includes(query)) : collections;
  const statuses: { st: Status; label: string; icon: React.ReactNode; kbd?: string }[] = [
    { st: "to_buy", label: t.flow.toBuy, icon: <ShoppingCart /> },
    { st: "ordered", label: t.quick.onTheWay, icon: <Truck />, kbd: "O" },
    { st: "purchased", label: t.quick.received, icon: <PackageCheck />, kbd: "R" },
  ];
  const row = "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-start text-sm outline-none hover:bg-sunken focus-visible:bg-sunken disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted";
  const label = "px-2.5 pb-1 pt-2 text-xs font-medium text-faint";
  return (
    <div role="menu" aria-label={t.select.moveTo} data-move-menu className="flex max-h-[min(440px,70vh)] flex-col">
      <div className={label}>{t.select.status}</div>
      <div className="grid grid-cols-3 gap-1 px-1">
        {statuses.map((x) => (
          <button
            key={x.st}
            type="button"
            role="menuitem"
            disabled={allIn(x.st)}
            onClick={() => onStatus(x.st)}
            data-move-status={x.st}
            title={x.kbd ? `${x.label} · ${x.kbd}` : x.label}
            className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl bg-surface-2 px-1 text-[12.5px] font-semibold hover:bg-line focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-45 [&_svg]:size-4 [&_svg]:text-muted"
          >
            {x.icon}
            <span className="max-w-full truncate">{x.label}</span>
          </button>
        ))}
      </div>
      <div className="mx-1 my-1.5 h-px bg-line" />
      <div className={label}>{t.select.lists}</div>
      {collections.length > 8 && (
        <label className="mx-1 mb-1 flex h-9 items-center gap-2 rounded-lg bg-sunken px-2.5 text-sm">
          <Search className="size-4 shrink-0 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.select.searchLists} aria-label={t.select.searchLists} className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint" data-move-search />
        </label>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {!collections.length && (
          <p className="px-2.5 py-1.5 text-[13px] leading-snug text-muted" data-move-empty>
            {t.select.noLists}
          </p>
        )}
        {!!collections.length && !shown.length && <p className="px-2.5 py-1.5 text-[13px] text-muted">{t.select.noMatch}</p>}
        {shown.map((c) => {
          const here = chosen.every((i) => i.collectionId === c.id);
          return (
            <button key={c.id} type="button" role="menuitem" onClick={() => onMove(c.id)} disabled={here} className={row} data-move-to={c.id}>
              <span className={cn("size-2.5 shrink-0", c.kind === "project" ? "rounded-[3px]" : "rounded-full")} style={{ background: COLLECTION_COLORS[c.color] }} />
              <span className="min-w-0 flex-1 truncate bidi">{c.name}</span>
              {here && <Check />}
            </button>
          );
        })}
      </div>
      {inSome && (
        <button type="button" role="menuitem" onClick={() => onMove(null)} className={row} data-select-unassign>
          <X />
          {t.select.removeFromProject}
        </button>
      )}
      {naming == null ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setNaming(q.trim());
            setTimeout(() => nameRef.current?.focus(), 0);
          }}
          className={cn(row, "text-accent-ink [&_svg]:text-accent-ink")}
          data-move-new
        >
          <ListPlus />
          {t.select.newList}
        </button>
      ) : (
        <form
          className="flex items-center gap-1.5 p-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (naming.trim()) onNewList(naming.trim().slice(0, 80));
          }}
        >
          <Input ref={nameRef} value={naming} onChange={(e) => setNaming(e.target.value)} placeholder={t.select.newListName} aria-label={t.select.newListName} className="h-9 min-w-0 flex-1 bidi" maxLength={80} data-move-new-name />
          <Button type="submit" size="sm" variant="accent" disabled={!naming.trim()} data-move-create>
            {t.select.create}
          </Button>
        </form>
      )}
    </div>
  );
}
