"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ContextMenu as CM, Dialog as D } from "radix-ui";
import { ArrowLeft, CheckSquare, ExternalLink, FolderInput, Inbox, Link2, PackageCheck, Scale, SquareArrowOutUpRight, Trash2, Truck, Undo2, X } from "lucide-react";
import { bulkDelete, bulkSetStatus, bulkUpdate, restoreItems } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { activeSource } from "@/lib/calc";
import { toast } from "@/lib/toast";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { morphOpen, optimisticStatus, useImportWarning, useStatusFlow, type Status } from "./item-card";
import { SheetHandle } from "@/components/ui/overlays";
import { useBackClose, useSheetDrag } from "@/components/ui/sheet-drag";
import { useReadOnly } from "./offline-banner";
import { useDataStore, useStore } from "./store";
import { basesFor, useBulkConflicts } from "./conflicts";
import { COLLECTION_COLORS } from "./view-items";

/**
 * Quick actions on products (Round 11 C1/C2): one set — status, move, delete (with Undo), open, copy link, compare,
 * select — offered everywhere a product appears: phone row swipes and the long-press action sheet, the desktop card
 * hover bar, the right-click menu and keys (O / R / M / Delete / Enter), the item sheet's "…" menu and the
 * multi-select bar.
 */

/** Status moves offered for an item, in order: To buy → On the way, Received; On the way → Received, Back to To buy;
 *  Received → Back to To buy. */
export function statusActs(status: Status): Status[] {
  return status === "to_buy" ? ["ordered", "purchased"] : status === "ordered" ? ["purchased", "to_buy"] : ["to_buy"];
}

export const SHORTCUT: Partial<Record<Status | "move" | "delete" | "open", string>> = { ordered: "O", purchased: "R", move: "M", delete: "Del", open: "Enter" };

export function StatusIcon({ status, className }: { status: Status; className?: string }) {
  const I = status === "ordered" ? Truck : status === "purchased" ? PackageCheck : Undo2;
  return <I className={className} />;
}

export function useActionLabels() {
  const { t } = useI18n();
  return {
    status: (st: Status) => (st === "ordered" ? t.quick.onTheWay : st === "purchased" ? t.quick.received : t.quick.backToBuy),
    tip: (label: string, key?: string) => (key ? `${label} · ${key}` : label),
  };
}

export function useItemActions() {
  const s = useDataStore();
  const bulkDone = useBulkConflicts();
  const { t, f } = useI18n();
  const flow = useStatusFlow();
  const warnImport = useImportWarning();

  const setStatus = async (items: ItemWithSources[], status: Status) => {
    const list = items.filter((i) => i.status !== status);
    if (!list.length) return;
    if (list.length === 1) return flow.setTo(list[0], status);
    const entries = list.map((i) => {
      const src = activeSource(i, s.rates);
      const paid = status !== "to_buy" && i.status === "to_buy" && src?.price != null ? { price: src.price + (src.shipping ?? 0), currency: src.currency } : null;
      return { item: i, paid };
    });
    if (status === "ordered") warnImport(list);
    s.upsertItems(entries.map((e) => optimisticStatus(e.item, status, e.paid)));
    s.clearSelection();
    // R16 B3: against the status each item showed (a conflict is reported once, not overwritten).
    const send = (list: typeof entries) => bulkSetStatus(list.map((e) => ({ id: e.item.id, paid: e.paid })), status, basesFor(list.map((e) => e.item), { status: 0 }));
    try {
      bulkDone(await send(entries), (fresh) => send(fresh.map((item) => ({ item, paid: entries.find((e) => e.item.id === item.id)?.paid ?? null }))));
      toast.success(status === "ordered" ? t.flow.markedOrdered : status === "purchased" ? t.flow.markedReceived : t.quick.backToBuy, {
        description: f(t.collection.itemsCount, { n: list.length }),
        action: {
          label: t.item.undo,
          onClick: async () => {
            s.upsertItems(list);
            for (const st of ["to_buy", "ordered", "purchased"] as const) {
              const back = list.filter((i) => i.status === st);
              if (back.length) s.upsertItems(await bulkSetStatus(back.map((i) => ({ id: i.id, paid: null })), st));
            }
          },
        },
      });
    } catch {
      s.upsertItems(list);
      toast.error(t.errors.generic);
    }
  };

  const remove = async (items: ItemWithSources[]) => {
    if (!items.length) return;
    const ids = items.map((i) => i.id);
    s.removeItems(ids);
    s.clearSelection();
    const req = bulkDelete(ids);
    const id = toast(items.length === 1 ? t.item.deleted : f(t.select.deleted, { n: items.length }), {
      description: items.length === 1 ? items[0].title : undefined,
      action: { label: t.item.undo, onClick: async () => s.upsertItems(await restoreItems(await req)) },
    });
    try {
      await req;
    } catch {
      s.upsertItems(items);
      toast.error(t.errors.generic, { id });
    }
  };

  const move = async (items: ItemWithSources[], collectionId: string | null) => {
    if (!items.length) return;
    const ids = items.map((i) => i.id);
    s.upsertItems(items.map((i) => ({ ...i, collectionId })));
    s.clearSelection();
    const name = collectionId ? (s.collections.find((c) => c.id === collectionId)?.name ?? "") : t.nav.unsorted;
    const id = toast.success(f(t.select.moved, { name }), { description: items.length === 1 ? items[0].title : f(t.collection.itemsCount, { n: items.length }) });
    try {
      s.upsertItems(await bulkUpdate(ids, { collectionId }));
    } catch {
      s.upsertItems(items);
      toast.dismiss(id);
      toast.error(t.errors.generic);
    }
  };

  const copyLink = async (item: ItemWithSources) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?item=${encodeURIComponent(item.id)}`);
      toast.success(t.quick.linkCopied);
    } catch {
      toast.error(t.errors.generic);
    }
  };

  return {
    setStatus,
    remove,
    move,
    copyLink,
    open: (item: ItemWithSources) => morphOpen(item.id, () => s.openItem(item.id)),
    compare: (item: ItemWithSources) => s.setCompareItemId(item.id),
    select: (item: ItemWithSources) => s.toggleSelect(item.id),
  };
}

/** The items an action on `item` applies to: the whole selection when `item` is part of it, otherwise just `item`. */
export function useTargets() {
  const s = useDataStore();
  return (item: ItemWithSources) => (s.selected.has(item.id) && s.selected.size > 1 ? s.items.filter((i) => s.selected.has(i.id)) : [item]);
}

/* ---------- The action sheet (phone long-press; desktop: M opens it on its "Move to" page) ---------- */

type SheetState = { ids: string[]; page: "menu" | "move" } | null;
let sheet: SheetState = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export function openItemActions(ids: string[], page: "menu" | "move" = "menu") {
  sheet = { ids, page };
  emit();
}
const closeSheet = () => {
  sheet = null;
  emit();
};
const useSheet = () =>
  useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => sheet,
    () => null,
  );

export function ItemActionSheet() {
  const st = useSheet();
  const s = useStore();
  const { t, f } = useI18n();
  const ro = useReadOnly();
  const acts = useItemActions();
  const labels = useActionLabels();
  const [page, setPage] = useState<"menu" | "move">("menu");
  const [shownFor, setShownFor] = useState<SheetState>(null);
  if (st !== shownFor) {
    setShownFor(st);
    if (st) setPage(st.page);
  }
  const items = st ? s.items.filter((i) => st.ids.includes(i.id)) : [];
  const one = items.length === 1 ? items[0] : null;
  const shown = !!st && items.length > 0;
  const drag = useSheetDrag(closeSheet);
  useBackClose(shown, closeSheet);
  const statuses = one ? statusActs(one.status) : (["ordered", "purchased", "to_buy"] as Status[]);
  const run = (fn: () => unknown) => {
    closeSheet();
    setTimeout(fn, 60);
  };
  const row = "flex min-h-[52px] w-full items-center gap-3.5 rounded-[16px] px-3 text-start text-[15px] font-semibold transition hover:bg-surface-2 active:bg-surface-2 disabled:opacity-50 [&>svg:first-child]:size-5 [&>svg:first-child]:shrink-0";
  const collections = s.collections.filter((c) => !c.archived);

  return (
    <D.Root open={shown} onOpenChange={(o) => !o && closeSheet()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40 overlay-in" data-sheet-scrim />
        <D.Content
          ref={drag}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[80vh] w-full max-w-md flex-col rounded-t-[26px] border border-line bg-surface pb-[max(12px,env(safe-area-inset-bottom))] shadow-pop outline-none actions-sheet sm:inset-x-0 sm:bottom-auto sm:top-[14vh] sm:w-[calc(100vw-24px)] sm:rounded-2xl sm:pb-2"
          aria-describedby={undefined}
          data-item-actions={page}
          onEscapeKeyDown={(e) => {
            if (page === "move" && st?.page === "menu") {
              e.preventDefault();
              setPage("menu");
            }
          }}
        >
          <SheetHandle />
          <div className="flex items-center gap-2 px-4 pb-2 pt-1 sm:pt-3" data-sheet-grip>
            {page === "move" && st?.page === "menu" && (
              <button type="button" onClick={() => setPage("menu")} className="-ms-1 grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2" aria-label={t.report.back} data-item-actions-back>
                <ArrowLeft className="size-[18px] rtl:-scale-x-100" />
              </button>
            )}
            <D.Title className="bidi min-w-0 flex-1 truncate text-[16px] font-extrabold">
              {page === "move" ? t.quick.move : one ? one.title : f(t.select.selected, { n: items.length })}
            </D.Title>
            <D.Close className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2" aria-label={t.phone.closeMenu}>
              <X className="size-[18px]" />
            </D.Close>
          </div>
          <div className="min-h-0 overflow-y-auto px-2 pb-1">
            {page === "menu" ? (
              <div key="menu" className={st?.page === "menu" ? undefined : "subpage-back"}>
                {statuses.map((x) => (
                  <button key={x} type="button" className={row} disabled={ro.ro} onClick={() => run(() => acts.setStatus(items, x))} data-item-action={x}>
                    <StatusIcon status={x} className={x === "ordered" ? "text-info" : x === "purchased" ? "text-ok" : "text-muted"} />
                    <span className="flex-1">{labels.status(x)}</span>
                  </button>
                ))}
                <button type="button" className={row} disabled={ro.ro} onClick={() => setPage("move")} data-item-action="move">
                  <FolderInput className="text-muted" />
                  <span className="flex-1">{t.quick.move}</span>
                </button>
                {one && !s.selected.has(one.id) && (
                  <button type="button" className={row} onClick={() => run(() => acts.select(one))} data-item-action="select">
                    <CheckSquare className="text-muted" />
                    <span className="flex-1">{t.select.select}</span>
                  </button>
                )}
                <button type="button" className={cn(row, "text-danger")} disabled={ro.ro} onClick={() => run(() => acts.remove(items))} data-item-action="delete">
                  <Trash2 />
                  <span className="flex-1">{t.quick.delete}</span>
                </button>
              </div>
            ) : (
              <div key="move" className="subpage-in" data-move-list>
                <button type="button" className={row} onClick={() => run(() => acts.move(items, null))}>
                  <Inbox className="text-muted" />
                  <span className="flex-1">{t.nav.unsorted}</span>
                </button>
                {collections.map((c) => (
                  <button key={c.id} type="button" className={cn(row, one?.collectionId === c.id && "bg-surface-2")} onClick={() => run(() => acts.move(items, c.id))} data-move-to={c.id}>
                    <span className="grid size-5 shrink-0 place-items-center">
                      <i className={cn("size-3", c.kind === "project" ? "rounded-[4px]" : "rounded-full")} style={{ background: COLLECTION_COLORS[c.color] }} />
                    </span>
                    <span className="bidi min-w-0 flex-1 truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/* ---------- Desktop: right-click menu ---------- */

const coarseQuery = "(hover: none) and (pointer: coarse)";
function useCoarse() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(coarseQuery);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(coarseQuery).matches,
    () => false,
  );
}

const cmItem =
  "flex h-9 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-sunken [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted";
const Kbd = ({ k }: { k?: string }) => (k ? <kbd className="ms-auto ps-4 font-sans text-[11px] font-semibold text-faint">{k}</kbd> : null);

/** Right-click on a card or table row (fine pointers only; phones long-press instead). */
export function ItemContextMenu({ item, children }: { item: ItemWithSources; children: React.ReactNode }) {
  const s = useDataStore();
  const { t, f } = useI18n();
  const ro = useReadOnly();
  const coarse = useCoarse();
  const acts = useItemActions();
  const labels = useActionLabels();
  const targets = useTargets();
  const [list, setList] = useState<ItemWithSources[]>([item]);
  const many = list.length > 1;
  const store = activeSource(item, s.rates);
  const collections = s.collections.filter((c) => !c.archived);
  const statuses = many ? (["ordered", "purchased", "to_buy"] as Status[]) : statusActs(item.status);
  return (
    <CM.Root onOpenChange={(o) => o && setList(targets(item))}>
      <CM.Trigger asChild disabled={coarse}>
        {children}
      </CM.Trigger>
      <CM.Portal>
        <CM.Content className="z-50 min-w-[230px] animate-pop-in rounded-xl border border-line bg-raised p-1 shadow-pop" data-item-menu>
          {many ? (
            <CM.Label className="px-2.5 pb-1 pt-1.5 text-xs text-faint">{f(t.select.selected, { n: list.length })}</CM.Label>
          ) : (
            <CM.Item className={cmItem} onSelect={() => acts.open(item)}>
              <SquareArrowOutUpRight /> {t.quick.open} <Kbd k={SHORTCUT.open} />
            </CM.Item>
          )}
          {statuses.map((x) => (
            <CM.Item key={x} className={cmItem} disabled={ro.ro} onSelect={() => void acts.setStatus(list, x)} data-item-action={x}>
              <StatusIcon status={x} /> {labels.status(x)} <Kbd k={SHORTCUT[x]} />
            </CM.Item>
          ))}
          <CM.Sub>
            <CM.SubTrigger className={cn(cmItem, "data-[state=open]:bg-sunken")} disabled={ro.ro} data-item-action="move">
              <FolderInput /> {t.quick.move} <Kbd k={SHORTCUT.move} />
            </CM.SubTrigger>
            <CM.Portal>
              <CM.SubContent className="z-50 max-h-80 min-w-[200px] overflow-y-auto rounded-xl border border-line bg-raised p-1 shadow-pop" sideOffset={4}>
                <CM.Item className={cmItem} onSelect={() => void acts.move(list, null)}>
                  <Inbox /> {t.nav.unsorted}
                </CM.Item>
                <CM.Separator className="my-1 h-px bg-line" />
                {collections.map((c) => (
                  <CM.Item key={c.id} className={cmItem} onSelect={() => void acts.move(list, c.id)}>
                    <i className={cn("size-2.5 shrink-0", c.kind === "project" ? "rounded-[3px]" : "rounded-full")} style={{ background: COLLECTION_COLORS[c.color] }} />
                    <span className="bidi truncate">{c.name}</span>
                  </CM.Item>
                ))}
              </CM.SubContent>
            </CM.Portal>
          </CM.Sub>
          {!many && (
            <>
              <CM.Separator className="my-1 h-px bg-line" />
              {item.status === "to_buy" && (
                <CM.Item className={cmItem} onSelect={() => acts.compare(item)}>
                  <Scale /> {t.compare.button}
                </CM.Item>
              )}
              {store?.url && (
                <CM.Item className={cmItem} onSelect={() => window.open(store.url!, "_blank", "noopener,noreferrer")}>
                  <ExternalLink /> {t.item.openStore}
                </CM.Item>
              )}
              <CM.Item className={cmItem} onSelect={() => void acts.copyLink(item)} data-item-action="copy">
                <Link2 /> {t.quick.copyLink}
              </CM.Item>
              {!s.selected.has(item.id) && (
                <CM.Item className={cmItem} onSelect={() => acts.select(item)}>
                  <CheckSquare /> {t.select.select}
                </CM.Item>
              )}
            </>
          )}
          <CM.Separator className="my-1 h-px bg-line" />
          <CM.Item className={cn(cmItem, "text-danger [&_svg]:text-danger")} disabled={ro.ro} onSelect={() => void acts.remove(list)} data-item-action="delete">
            <Trash2 /> {t.quick.delete} <Kbd k={SHORTCUT.delete} />
          </CM.Item>
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

/* ---------- Desktop: keys ---------- */

/** O / R / M / Delete on the focused card or the selection; Enter opens the focused card (it is a button). */
export function ItemShortcuts() {
  const s = useStore();
  const acts = useItemActions();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || s.readOnly) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]")) return;
      if (document.querySelector("[role=dialog]")) return;
      const k = e.key.toLowerCase();
      if (!["o", "r", "m", "delete", "backspace"].includes(k)) return;
      const focused = el?.closest<HTMLElement>("[data-item-card], [data-item-row]");
      const id = focused?.dataset.itemCard ?? focused?.dataset.itemRow;
      const items = s.selected.size ? s.items.filter((i) => s.selected.has(i.id)) : id ? s.items.filter((i) => i.id === id) : [];
      if (!items.length) return;
      e.preventDefault();
      if (k === "o") void acts.setStatus(items, "ordered");
      else if (k === "r") void acts.setStatus(items, "purchased");
      else if (k === "m") openItemActions(items.map((i) => i.id), "move");
      else void acts.remove(items);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s, acts]);
  return null;
}
