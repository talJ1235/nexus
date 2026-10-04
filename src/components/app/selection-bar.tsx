"use client";

import { useState, useEffect } from "react";
import { ArrowRightLeft, CircleDot, Flag, Split, Trash2, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { bulkDelete, bulkSetStatus, bulkUpdate, createAltGroup, restoreItems } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { Button, Input } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Pop, PopContent, PopTrigger } from "@/components/ui/overlays";
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
  const [altOpen, setAltOpen] = useState(false);
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
  if (!n || s.offlineAt != null) return null;

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      toast.error(t.errors.generic);
    }
  };

  const setPatch = (patch: { collectionId?: string | null; priority?: "urgent" | "normal" | "someday" }) =>
    run(async () => {
      s.upsertItems(chosen.map((i) => ({ ...i, ...patch })));
      const req = bulkUpdate(ids, patch);
      let id: string | number | undefined;
      if (patch.collectionId !== undefined) {
        const name = patch.collectionId ? s.collections.find((c) => c.id === patch.collectionId)?.name ?? "" : t.nav.unsorted;
        id = toast.success(f(t.select.moved, { name }), { description: f(t.collection.itemsCount, { n }) });
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
      setAltOpen(false);
      setAltName("");
      s.clearSelection();
      toast.success(t.alt.created, { action: { label: t.alt.open, onClick: () => s.openAlt(res.groupId) } });
    });

  const canCompare = n >= 2 && chosen.every((i) => i.status === "to_buy");
  const collections = s.collections.filter((c) => !c.archived);

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

        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" variant="ghost" className="text-fg" title={`${t.select.moveTo} · M`}>
              <ArrowRightLeft />
              <span className="max-sm:hidden">{t.select.moveTo}</span>
            </Button>
          </MenuTrigger>
          <MenuContent align="center" className="max-h-80 overflow-y-auto">
            <MenuItem onSelect={() => void setPatch({ collectionId: null })}>{t.nav.unsorted}</MenuItem>
            <MenuSeparator />
            {collections.map((c) => (
              <MenuItem key={c.id} onSelect={() => void setPatch({ collectionId: c.id })}>
                <span className={cn("size-2.5 shrink-0", c.kind === "project" ? "rounded-[3px]" : "rounded-full")} style={{ background: COLLECTION_COLORS[c.color] }} />
                {c.name}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>

        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" variant="ghost" className="text-fg">
              <Flag />
              <span className="max-sm:hidden">{t.item.priority}</span>
            </Button>
          </MenuTrigger>
          <MenuContent align="center">
            {(["urgent", "normal", "someday"] as const).map((p) => (
              <MenuItem key={p} onSelect={() => void setPatch({ priority: p })}>
                {t.item[p]}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>

        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" variant="ghost" className="text-fg">
              <CircleDot />
              <span className="max-sm:hidden">{t.select.status}</span>
            </Button>
          </MenuTrigger>
          <MenuContent align="center">
            <MenuItem onSelect={() => void setStatusAll("to_buy")}>{t.flow.toBuy}</MenuItem>
            <MenuItem onSelect={() => void setStatusAll("ordered")}>
              <span className="flex-1">{t.flow.markOrdered}</span> <kbd className="font-sans text-[11px] text-faint">O</kbd>
            </MenuItem>
            <MenuItem onSelect={() => void setStatusAll("purchased")}>
              <span className="flex-1">{t.flow.markReceived}</span> <kbd className="font-sans text-[11px] text-faint">R</kbd>
            </MenuItem>
          </MenuContent>
        </Menu>

        {canCompare && (
          <Pop open={altOpen} onOpenChange={setAltOpen}>
            <PopTrigger asChild>
              <Button size="sm" variant="ghost" className="text-accent-ink">
                <Split />
                <span className="max-sm:hidden">{t.select.compare}</span>
              </Button>
            </PopTrigger>
            <PopContent align="center" className="w-72">
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
