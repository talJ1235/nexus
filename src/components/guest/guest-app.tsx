"use client";

import { useMemo, useState } from "react";
import { Check, ExternalLink, Languages, Link2, Minus, Moon, Plus, Sun, Trash2, Truck, Undo2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { guestAddItem, guestDeleteItem, guestRepairItem, guestSetStatus, guestUpdateItem } from "@/app/guest-actions";
import { ProductImage } from "@/components/app/item-card";
import { COLLECTION_COLORS } from "@/components/app/view-items";
import { LogoMark } from "@/components/logo";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { activeSource, lineTotal, sumTotals, unitPrice } from "@/lib/calc";
import type { GuestData } from "@/lib/guest";
import { CURRENCIES, CURRENCY_COOKIE, formatMoney, type Currency } from "@/lib/money";
import type { ItemWithSources } from "@/lib/types";
import { cn, extractUrls } from "@/lib/utils";

type Status = ItemWithSources["status"];
const NEXT: Record<Status, Status> = { to_buy: "ordered", ordered: "purchased", purchased: "to_buy" };

function rememberCurrency(c: Currency) {
  document.cookie = `${CURRENCY_COOKIE}=${c}; path=/; max-age=31536000; samesite=lax`;
}

export function GuestApp({ data, initialCollection, initialCurrency }: { data: GuestData; initialCollection: string | null; initialCurrency: Currency }) {
  const { t, f, locale, setLocale } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const [items, setItems] = useState(data.items);
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency);
  const [active, setActive] = useState(initialCollection && data.collections.some((c) => c.id === initialCollection) ? initialCollection : data.collections[0]?.id ?? null);
  const [link, setLink] = useState("");
  const [adding, setAdding] = useState(false);

  const collection = data.collections.find((c) => c.id === active) ?? null;
  const canEdit = collection?.role === "editor";
  const list = useMemo(() => {
    const mine = items.filter((i) => i.collectionId === active);
    const rank: Record<Status, number> = { to_buy: 0, ordered: 1, purchased: 2 };
    return mine.sort((a, b) => rank[a.status] - rank[b.status] || b.createdAt - a.createdAt);
  }, [items, active]);
  const total = sumTotals(list.filter((i) => i.status === "to_buy"), data.rates, currency).total;

  const upsert = (i: ItemWithSources) => setItems((prev) => (prev.some((p) => p.id === i.id) ? prev.map((p) => (p.id === i.id ? i : p)) : [i, ...prev]));
  const setCurrency = (c: Currency) => {
    setCurrencyState(c);
    rememberCurrency(c);
  };

  // A link whose name/price/picture didn't come through gets re-read quietly in the background.
  const heal = async (item: ItemWithSources, attempt = 0) => {
    const src = item.sources.find((x) => x.url);
    const incomplete = src && (!src.rawTitle || src.price == null || !item.imageUrl);
    if (!incomplete || attempt >= 3) return;
    // Retries also pick up what the background helper fetcher filled in meanwhile (~30–60 s).
    await new Promise((r) => setTimeout(r, [4000, 25000, 50000][attempt]));
    try {
      const fixed = await guestRepairItem(item.id);
      upsert(fixed);
      void heal(fixed, attempt + 1);
    } catch {
      /* the daily repair pass will try again */
    }
  };

  const add = async (text: string) => {
    const url = extractUrls(text)[0];
    if (!url || !collection) return toast.error(t.add.invalidUrl);
    setAdding(true);
    setLink("");
    try {
      const r = await guestAddItem(url, collection.id);
      upsert(r.item);
      if (!r.existed) void heal(r.item);
      toast[r.existed ? "info" : "success"](r.existed ? t.share.exists : t.add.added, { description: r.item.title });
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setAdding(false);
    }
  };

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      toast.error(t.errors.generic);
    }
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <LogoMark />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium bidi">
              {data.member.name}
            </div>
            <div className="text-xs text-faint">{t.share.sharedBy}</div>
          </div>
          <div className="flex rounded-lg border border-line bg-surface p-0.5 text-xs">
            {CURRENCIES.map((c) => (
              <button key={c} type="button" onClick={() => setCurrency(c)} className={cn("h-7 min-w-7 rounded-md px-1.5", currency === c ? "bg-fg text-bg" : "text-muted hover:text-fg")}>
                {c === "ILS" ? "₪" : c === "USD" ? "$" : "€"}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label={t.cmd.toggleTheme}>
            {resolvedTheme === "dark" ? <Sun /> : <Moon />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setLocale(locale === "en" ? "he" : "en")} aria-label={t.cmd.switchLang} title={t.cmd.switchLang}>
            <Languages />
          </Button>
        </div>
        {data.collections.length > 1 && (
          <div className="mx-auto flex max-w-3xl gap-1.5 overflow-x-auto px-4 pb-3">
            {data.collections.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActive(c.id)}
                className={cn("inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-[13px] transition", active === c.id ? "border-fg bg-fg text-bg" : "border-line text-muted hover:text-fg")}
              >
                <span className={cn("size-2", c.kind === "project" ? "rounded-[2px]" : "rounded-full")} style={{ background: COLLECTION_COLORS[c.color] }} />
                {c.name}
              </button>
            ))}
          </div>
        )}
      </header>

      {collection && (
        <main className="view-in mx-auto max-w-3xl px-4 pb-24 pt-6" key={collection.id}>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] bidi">
            {collection.name}
          </h1>
          {collection.description && (
            <p className="mt-1 text-sm text-muted bidi">
              {collection.description}
            </p>
          )}
          <p className="tabular mt-1 text-sm text-muted">
            {f(t.collection.itemsCount, { n: list.length })}
            {total > 0 && (
              <>
                <span className="mx-2 text-faint">/</span>
                {t.view.itemsTotal} <b className="text-fg">{formatMoney(total, currency, locale)}</b>
              </>
            )}
            <span className="mx-2 text-faint">/</span>
            {canEdit ? t.share.editor : t.share.viewer}
          </p>

          {canEdit && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void add(link);
              }}
              className="mt-5 flex h-12 items-center rounded-xl border border-line-strong bg-surface shadow-card transition focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15"
            >
              <Link2 className="ms-4 size-[18px] shrink-0 text-faint" />
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text");
                  if (extractUrls(text).length && !link) {
                    e.preventDefault();
                    void add(text);
                  }
                }}
                placeholder={t.share.guestAddHint}
                inputMode="url"
                className="h-full min-w-0 flex-1 bg-transparent px-3 text-[15px] outline-none placeholder:text-faint"
              />
              <Button type="submit" variant="accent" size="sm" className="me-1.5 h-9" disabled={adding || !link.trim()}>
                {adding ? <Spinner /> : <Plus />}
              </Button>
            </form>
          )}

          <ul className="mt-5 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {list.map((i) => {
              const src = activeSource(i, data.rates);
              const unit = unitPrice(i, data.rates, currency);
              const line = lineTotal(i, data.rates, currency);
              const done = i.status === "purchased";
              return (
                <li key={i.id} className={cn("flex items-center gap-3 p-3 sm:p-4", done && "opacity-60")}>
                  <ProductImage src={i.imageUrl} alt="" className="size-14 shrink-0 rounded-lg" iconClass="size-5" />
                  <div className="min-w-0 flex-1">
                    <p className={cn("bidi line-clamp-2 text-sm font-medium", done && "line-through")}>
                      {i.title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {src?.url ? src.store : ""}
                      {i.addedByName && (
                        <span className="text-faint">
                          {src?.url ? " · " : ""}
                          {f(t.share.addedBy, { name: i.addedByMemberId === data.member.id ? t.share.you : i.addedByName })}
                        </span>
                      )}
                    </p>
                    {canEdit && !done && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="−"
                          disabled={i.quantity <= 1}
                          onClick={() => guard(async () => upsert(await guestUpdateItem(i.id, { quantity: i.quantity - 1 })))}
                          className="grid size-6 place-items-center rounded-md border border-line text-muted hover:text-fg disabled:opacity-40"
                        >
                          <Minus className="size-3" />
                        </button>
                        <span className="tabular w-7 text-center text-xs">{i.quantity}</span>
                        <button
                          type="button"
                          aria-label="+"
                          onClick={() => guard(async () => upsert(await guestUpdateItem(i.id, { quantity: i.quantity + 1 })))}
                          className="grid size-6 place-items-center rounded-md border border-line text-muted hover:text-fg"
                        >
                          <Plus className="size-3" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-end">
                    {unit != null ? <span className="price-tag text-[13px]">{formatMoney(unit, currency, locale)}</span> : <span className="price-tag muted text-[12px]">{t.item.noPrice}</span>}
                    {i.quantity > 1 && line != null && <div className="tabular mt-1 text-xs text-muted">×{i.quantity} = {formatMoney(line, currency, locale)}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                    {src?.url && (
                      <a href={src.url} target="_blank" rel="noopener noreferrer" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-fg" aria-label={t.item.openStore} title={t.item.openStore}>
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => guard(async () => upsert(await guestSetStatus(i.id, NEXT[i.status])))}
                        className={cn(
                          "grid size-8 place-items-center rounded-lg transition",
                          i.status === "to_buy" ? "text-muted hover:bg-sunken hover:text-fg" : i.status === "ordered" ? "bg-info/15 text-info" : "bg-ok-soft text-ok",
                        )}
                        title={i.status === "to_buy" ? t.flow.ordered : i.status === "ordered" ? t.flow.received : t.item.markToBuy}
                        aria-label={i.status === "to_buy" ? t.flow.ordered : i.status === "ordered" ? t.flow.received : t.item.markToBuy}
                      >
                        {i.status === "to_buy" ? <Truck className="size-4" /> : i.status === "ordered" ? <Check className="size-4" /> : <Undo2 className="size-4" />}
                      </button>
                    )}
                    {canEdit && i.addedByMemberId === data.member.id && (
                      <button
                        type="button"
                        onClick={() =>
                          guard(async () => {
                            await guestDeleteItem(i.id);
                            setItems((prev) => prev.filter((p) => p.id !== i.id));
                          })
                        }
                        className="grid size-8 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"
                        aria-label={t.share.deleteOwn}
                        title={t.share.deleteOwn}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
            {!list.length && <li className="p-10 text-center text-sm text-muted">{t.share.guestEmpty}</li>}
          </ul>
        </main>
      )}
    </div>
  );
}
