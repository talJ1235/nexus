"use client";

import { Check, ExternalLink, LogOut, Trophy } from "lucide-react";
import { toast } from "sonner";
import { leaveAltGroup, updateAltGroup } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { activeSource, lineTotal, unitPrice } from "@/lib/calc";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PriceTag, ProductImage } from "./item-card";
import { useStore } from "./store";

/** Side-by-side comparison of a group of alternatives; pick the winner. */
export function AltSheet() {
  const s = useStore();
  const { t, locale } = useI18n();
  const group = s.altOpenId ? s.altGroups.find((g) => g.id === s.altOpenId) ?? null : null;
  const members = group ? s.items.filter((i) => i.altGroupId === group.id) : [];
  const prices = members.map((m) => lineTotal(m, s.rates, s.currency));
  const valid = prices.filter((p): p is number => p != null);
  const cheapest = valid.length ? Math.min(...valid) : null;

  const pick = async (itemId: string | null) => {
    if (!group) return;
    s.upsertAltGroup({ ...group, chosenItemId: itemId });
    try {
      s.upsertAltGroup(await updateAltGroup(group.id, { chosenItemId: itemId }));
    } catch {
      s.upsertAltGroup(group);
      toast.error(t.errors.generic);
    }
  };

  const rename = async (name: string) => {
    if (!group || !name.trim() || name.trim() === group.name) return;
    s.upsertAltGroup(await updateAltGroup(group.id, { name: name.trim() }));
  };

  const leave = async (itemId: string) => {
    const res = await leaveAltGroup(itemId);
    s.setItems(res.items);
    s.setAltGroups(res.altGroups);
    if (!res.altGroups.some((g) => g.id === group?.id)) s.openAlt(null);
  };

  return (
    <Modal open={!!group && members.length > 0} onOpenChange={(o) => !o && s.openAlt(null)} title={t.alt.title} description={t.alt.hint} className="max-w-5xl">
      {group && (
        <>
          <input
            key={group.id + group.name}
            defaultValue={group.name}
                        aria-label={t.alt.rename}
            onBlur={(e) => void rename(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="bidi -mx-1.5 mb-4 w-[calc(100%+12px)] rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xl font-semibold outline-none hover:border-line focus:border-accent"
          />
          <div className="-mx-5 overflow-x-auto px-5 pb-1">
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${members.length}, minmax(210px, 280px))` }}>
              {members.map((m, idx) => {
                const picked = group.chosenItemId === m.id;
                const src = activeSource(m, s.rates);
                const line = prices[idx];
                const isCheapest = cheapest != null && line === cheapest && valid.length > 1;
                const unit = unitPrice(m, s.rates, s.currency);
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex flex-col overflow-hidden rounded-xl border bg-bg/40 transition",
                      picked ? "border-ok shadow-[0_0_0_1px_var(--ok)]" : "border-line",
                    )}
                  >
                    <div className="relative">
                      <ProductImage src={m.imageUrl} alt="" className="aspect-[4/3] w-full" />
                      <div className="absolute start-2 top-2 flex gap-1">
                        {picked && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-ok px-1.5 py-0.5 text-[11px] font-semibold text-white">
                            <Trophy className="size-3" />
                            {t.alt.picked}
                          </span>
                        )}
                        {isCheapest && <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-accent-fg">{t.item.cheapest}</span>}
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-3">
                      <button type="button" onClick={() => { s.openAlt(null); s.openItem(m.id); }} className="line-clamp-3 text-start text-sm font-medium hover:underline bidi">
                        {m.title}
                      </button>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                        <dt className="text-faint">{t.table.store}</dt>
                        <dd className="truncate text-end">{src?.store ?? "—"}</dd>
                        <dt className="text-faint">{t.table.price}</dt>
                        <dd className="tabular text-end">{unit != null ? formatMoney(unit, s.currency, locale) : "—"}</dd>
                        <dt className="text-faint">{t.item.shipping}</dt>
                        <dd className="tabular text-end">{src?.shipping != null ? formatMoney(src.shipping, src.currency, locale) : "?"}</dd>
                        {m.quantity > 1 && (
                          <>
                            <dt className="text-faint">{t.table.qty}</dt>
                            <dd className="tabular text-end">{m.quantity}</dd>
                          </>
                        )}
                      </dl>
                      {m.notes && (
                        <p className="line-clamp-3 rounded-md bg-sunken px-2 py-1.5 text-xs text-muted bidi">
                          {m.notes}
                        </p>
                      )}
                      <div className="mt-auto pt-1">
                        <PriceTag item={m} />
                      </div>
                      <div className="flex gap-1.5 pt-1">
                        <Button size="sm" variant={picked ? "outline" : "accent"} className="flex-1" onClick={() => void pick(picked ? null : m.id)}>
                          {picked ? t.alt.unpick : (<><Check />{t.alt.pick}</>)}
                        </Button>
                        {src?.url && (
                          <a href={src.url} target="_blank" rel="noopener noreferrer" aria-label={t.item.openStore} title={t.item.openStore} className="grid size-8 place-items-center rounded-lg border border-line-strong text-muted hover:bg-sunken hover:text-fg">
                            <ExternalLink className="size-4" />
                          </a>
                        )}
                        <button type="button" onClick={() => void leave(m.id)} aria-label={t.alt.remove} title={t.alt.remove} className="grid size-8 place-items-center rounded-lg border border-line-strong text-muted hover:bg-danger-soft hover:text-danger">
                          <LogOut className="size-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
