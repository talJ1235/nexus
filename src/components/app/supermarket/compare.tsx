"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/components/providers";
import { Sheet } from "@/components/ui/overlays";
import { compareSmList } from "@/app/supermarket-actions";
import { chainById } from "@/lib/grocery/chains";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { Money } from "./money";
import { ChainLogo } from "./store-picker";
import { setTripStore } from "./trip-store";

// R19 D3 (board Compare-phone) — where is my list cheapest: the stores ranked by the list's total with deals (club on /
// off), per store the saving against mine, "8 of 9" + the missing rows on their own line (counted at the average price),
// the deals count; "Shop there this time" sets the trip's store; a split hint when two stores save enough (and says so
// when it's probably not worth the extra trip). The stores = every chain with prices + the branches the home chose.

const EVENT = "nexus:sm-compare";
export const openCompare = () => window.dispatchEvent(new Event(EVENT));
type Data = Awaited<ReturnType<typeof compareSmList>>;
const noSub = () => () => {};

export function Compare() {
  const [open, setOpen] = useState(false);
  const hydrated = useSyncExternalStore(noSub, () => true, () => false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const { t } = useI18n();
  if (!hydrated) return null;
  return (
    <Sheet open={open} onOpenChange={setOpen} title={t.sm.cmp.title} className="desk:max-w-[480px]">
      {open && <Body onClose={() => setOpen(false)} />}
    </Sheet>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const he = locale === "he";
  const [club, setClub] = useState(true);
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    let live = true;
    void compareSmList(club).then((d) => live && setData(d), () => live && setData(null));
    return () => {
      live = false;
    };
  }, [club]);
  const label = (key: string) => {
    const [chain, store] = key.split(":");
    const c = chainById(chain);
    const name = c ? (he ? c.he : c.en) : chain;
    return store ? `${name} · ${data?.names[key] ?? store}` : name;
  };
  const shopThere = (key: string) => {
    const [chain] = key.split(":");
    setTripStore(s.spaceId || "-", key.includes(":") ? { chain, branch: data?.names[key] ?? "", branchId: key } : { chain, branch: "" });
    toast(f(t.sm.store.tripOnly, { store: label(key) }));
    onClose();
  };
  const chip = (on: boolean) => cn("h-9 rounded-full px-3.5 text-[13px] font-bold transition-colors duration-150", on ? "bg-ink text-bg" : "bg-surface-2 text-ink/80");
  const best = data?.ranked[0];
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-compare>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1">
        <h2 className="text-[21px] font-extrabold">{t.sm.cmp.title}</h2>
        <p className="mt-0.5 text-[13px] text-muted">{data ? f(t.sm.cmp.sub, { n: data.ranked[0]?.found ?? 0, m: data.rows }) : "…"}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className={chip(true)} aria-current="true">{t.sm.cmp.all}</span>
          <button type="button" className={chip(club)} aria-pressed={club} onClick={() => setClub(!club)} data-compare-club={club ? "on" : "off"}>
            {club ? t.sm.cmp.clubOn : t.sm.cmp.clubOff}
          </button>
        </div>
        {!data && <div className="skeleton-in mt-3 h-40 rounded-[18px] bg-surface-2" />}
        {data && data.ranked.length === 0 && <p className="mt-3 rounded-[12px] bg-surface-2 px-3 py-2 text-[13px] text-muted">{t.sm.cmp.none}</p>}
        <div className="mt-3 flex flex-col gap-2" data-compare-list>
          {data?.ranked.map((x, k) => {
            const mine = x.store === data.mine;
            return (
              <div key={x.store} className={cn("rounded-[18px] bg-surface p-3 shadow-[0_0_0_1px_var(--line-in)]", mine && "shadow-[0_0_0_2px_var(--ink)]")} data-compare-store={x.store} data-rank={k + 1}>
                <div className="flex items-center gap-3">
                  <ChainLogo chain={x.store.split(":")[0]} size={36} />
                  <span className="min-w-0 flex-1">
                    <b className="bidi block truncate text-[15px] font-extrabold">{label(x.store)}</b>
                    <span className="block text-[12px] text-muted">
                      {f(t.sm.cmp.found, { n: x.found, m: x.found + x.missing.length })}
                      {x.deals ? ` · ${f(t.sm.cmp.deals, { n: x.deals })}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end leading-tight">
                    <Money v={x.total} className="text-[17px] font-extrabold" />
                    {mine ? <small className="text-[11.5px] text-muted">{t.sm.cmp.yours}</small> : x.saving > 0.004 ? <small className="text-[11.5px] font-bold text-[var(--save)]">{f(t.sm.cmp.saves, { amount: `₪${x.saving.toFixed(2)}` })}</small> : <small className="text-[11.5px] text-muted">{f(t.sm.cmp.more, { amount: `₪${(-x.saving).toFixed(2)}` })}</small>}
                  </span>
                </div>
                {x.missing.length > 0 && (
                  <p className="bidi mt-2 text-[12px] text-muted" data-compare-missing>
                    {f(t.sm.cmp.missing, { items: x.missing.map((m) => m.title).join(", ") })}
                  </p>
                )}
                {!mine && (
                  <button type="button" onClick={() => shopThere(x.store)} className="mt-2 h-10 w-full rounded-[12px] bg-surface-2 text-[13.5px] font-bold active:scale-[0.98]" data-compare-shop={x.store}>
                    {t.sm.cmp.shopThere}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {data?.split && best && (
          <p className="mt-3 rounded-[14px] bg-surface-2 px-3 py-2 text-[13px]" data-compare-split={data.split.worth ? "worth" : "not"}>
            {f(data.split.worth ? t.sm.cmp.splitWorth : t.sm.cmp.splitNot, { a: label(data.split.a), b: label(data.split.b), amount: `₪${data.split.saving.toFixed(2)}` })}
          </p>
        )}
        <p className="mt-3 px-1 text-[12px] text-muted">{t.sm.cmp.note}</p>
      </div>
    </div>
  );
}
