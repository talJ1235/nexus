"use client";

import "./sm.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, ChevronDown, ChevronRight, ClipboardPaste, CloudOff, Eye, History, LayoutList, ListOrdered, Mic, MoreHorizontal, Plus, ScanBarcode, ShoppingBasket, ShoppingCart, Sparkles, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlays";
import { acceptSuggestions, dismissSuggestion, setSupermarketLayout } from "@/app/supermarket-actions";
import { basketFor, WEEKLY_BASKET_SIZE, type BasketItem } from "@/lib/grocery/basket";
import { DEFAULT_ORDER, sectionName } from "@/lib/grocery/sections";
import { formatMoney } from "@/lib/money";
import { toast } from "@/lib/toast";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { ProductTile, SectionIcon, sectionColor } from "./art";
import { patchSmHome, useSmHome, type SmHome } from "./data";
import { asItem, chainDef, monoColor, useAddMany, useEstimate, useMonthLeft, useTrips } from "./numbers";
import { onSmIntent, takeSmIntent, type SmIntent } from "./intent";
import { AddScreen, type AddMode } from "./add-screen";
import { Capture } from "./capture";
import { SectionOrder, StorePicker } from "./store-picker";
import { useTripStore } from "./trip-store";
import { StoreMode } from "./store-mode";
import { useLocalTrip } from "./local-trip";
import { SmItemSheet, SuggestionActions } from "./item-sheet";
import { useVoiceSupported } from "./add-screen";
import { qtyLabel } from "./qty";
import { useOutboxCount } from "./outbox-count";
import { Lists, RoutineOffer, type ListsStart } from "./lists";
import { DeskPast, DeskTemplates, SendToPhone } from "./desk";
import { useDevice } from "@/components/ui/use-device";
import { OPEN_ITEM, openSmItem, Row, useSettled } from "./row";

// R18 S2 A2 — the Supermarket tab (board Supermarket-phone `Main`): store chip + estimate vs budget, the aisle rail, the
// add field, "Nexus suggests", the list by sections in the branch's order (rows or tiles, the ⋯ menu, per person),
// first-time state, viewer and offline. Section colours are always on.

type Sug = SmHome["suggestions"][number] | (BasketItem & { reasonKey: "basket"; reasonArgs: Record<string, never>; quietUntil: number });


/** The list grouped by section in `order` (unknown / `other` last). */
export function bySection(items: ItemWithSources[], order: readonly string[] = DEFAULT_ORDER) {
  const m = new Map<string, ItemWithSources[]>();
  for (const i of items) {
    const k = i.section && order.includes(i.section) ? i.section : "other";
    m.set(k, [...(m.get(k) ?? []), i]);
  }
  return [...order, "other"].filter((k) => m.has(k)).map((k) => [k, m.get(k)!] as const);
}

export function SupermarketView() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const { home } = useSmHome();
  const viewer = s.space?.role === "viewer";
  const ro = viewer || s.offlineAt != null;
  const [layout, setLayout] = useState<"rows" | "tiles" | null>(null);
  const shown = layout ?? home?.layout ?? "rows";
  // D2: this trip's store (a trip-only pick, else the default) and its branch's order.
  const trip = useTripStore(s.spaceId || "-", home);
  const serverTrip = useTrips(home).mine;
  const localTrip = useLocalTrip(s.spaceId || "-");
  const mineRunning = serverTrip != null || localTrip != null;
  const order = trip.order;
  const [picking, setPicking] = useState(false);
  const [shopping, setShopping] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [lists, setLists] = useState<ListsStart | null>(null);
  const openLists = (k: ListsStart) => setLists(k);
  const desk = useDevice() === "computer";
  const groups = useMemo(() => bySection(s.sm, order), [s.sm, order]);
  const [basketOn, setBasketOn] = useState(false);
  const addMany = useAddMany();
  // B2: the Add screen (typing / voice / paste); scan + photo arrive with B3.
  const [adding, setAdding] = useState<AddMode | null>(null);
  const [addHint, setAddHint] = useState<"camera" | null>(null);
  const [capturing, setCapturing] = useState<"scan" | "photo" | null>(null);
  // The camera's "Type instead" (or a refused camera permission, with a one-line hint): the Add screen.
  // C2: a photo of a list → the Paste review with its lines.
  const [addSeed, setAddSeed] = useState<string | null>(null);
  const typeInstead = useCallback((text?: string, hint?: "camera" | "list") => {
    setCapturing(null);
    setAddHint(hint === "camera" ? "camera" : null);
    setAddSeed(hint === "list" ? (text ?? "") : null);
    setAdding(hint === "list" ? "paste" : "type");
  }, []);
  const [openId, setOpenId] = useState<string | null>(null);
  // F3: "/" opens Add on a computer (not while typing somewhere).
  useEffect(() => {
    if (!desk || ro) return;
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || el?.closest?.("input, textarea, [contenteditable], [role=dialog]")) return;
      e.preventDefault();
      setAdding("type");
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [desk, ro]);
  useEffect(() => {
    const on = (e: Event) => setOpenId((e as CustomEvent<string>).detail);
    window.addEventListener(OPEN_ITEM, on);
    return () => window.removeEventListener(OPEN_ITEM, on);
  }, []);
  const openAdd = (m: AddMode | "scan" | "photo") => {
    if (m === "scan" || m === "photo") return capture(m);
    setAdding(m);
  };
  const [draft] = useState(() => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("draft") === "1" : false));

  // A1 intents (the dock's long-press menu, app-icon shortcuts): "add" focuses the field; the rest arrive with B3 / D3.
  useEffect(() => {
    const take = () => {
      const k = takeSmIntent();
      if (k) runIntent(k);
    };
    const runIntent = (k: SmIntent) => {
      if (k === "add") setAdding("type");
      if (k === "build") setBasketOn(true);
      if (k === "scan" || k === "photo") setCapturing(k);
      if (k === "shop") setShopping(true);
    };
    take();
    return onSmIntent(take);
  }, []);

  // First time: nothing on the list, no trips yet, and nothing learned to suggest (the cold-start basket waits for "Build
  // my list" — the server sends it as `basket` suggestions until the home has 4 trips).
  const first = !s.sm.length && (home ? home.trips === 0 && home.suggestions.every((x) => x.reasonKey === "basket") : false) && !basketOn;
  const basket = useMemo(() => basketFor({ who: s.obWho, locale }), [s.obWho, locale]);
  const pickLayout = (l: "rows" | "tiles") => {
    setLayout(l);
    if (home) patchSmHome(s.spaceId || "-", (h) => ({ ...h, layout: l }));
    void setSupermarketLayout(l).catch(() => {});
  };

  // F3: on a computer the page is two columns — the list, and a side panel (store + estimate, Nexus suggests, templates,
  // past trips) — with "Send to phone" in the header; phones keep one column.
  const header = (
    <div className="flex items-center gap-2">
      <h1 className="me-auto text-[26px] font-extrabold tracking-[-0.02em] desk:text-[28px]">{t.sm.title}</h1>
      {desk && <SendToPhone store={trip.store} />}
      <Menu>
        <MenuTrigger asChild>
          <button type="button" className="grid size-10 place-items-center rounded-full text-ink transition-transform duration-150 ease-[var(--ease-out)] active:scale-95" aria-label={t.sm.main.more} data-sm-more>
            <MoreHorizontal className="size-5" />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuLabel>{t.sm.main.showAs}</MenuLabel>
          <MenuRadioGroup value={shown} onValueChange={(v) => pickLayout(v as "rows" | "tiles")}>
            <MenuRadioItem value="rows" data-sm-layout-pick="rows">{t.sm.main.rows}</MenuRadioItem>
            <MenuRadioItem value="tiles" data-sm-layout-pick="tiles">{t.sm.main.tiles}</MenuRadioItem>
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem onSelect={() => setOrdering(true)} data-sm-menu-order>
            <ListOrdered className="size-4" />
            {t.sm.order.open}
          </MenuItem>
          <MenuItem onSelect={() => openLists("templates")} data-sm-menu-lists>
            <LayoutList className="size-4" />
            {t.sm.lists.open}
          </MenuItem>
          {/* R18 S3 B2: past trips live in Insights → History → Supermarket. */}
          <MenuItem onSelect={() => s.setView({ type: "history", src: "sm" })} data-sm-menu-past>
            <History className="size-4" />
            {t.sm.lists.past}
          </MenuItem>
          <MenuItem onSelect={() => s.openSettings("smLearned")} data-sm-menu-learned>
            <Sparkles className="size-4" />
            {t.sm.set.learned}
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
  const overlays = (
    <>
      <StorePicker open={picking} onClose={() => setPicking(false)} />
      <SectionOrder open={ordering} onClose={() => setOrdering(false)} onPickStore={() => setPicking(true)} />
      <Lists open={lists != null} onClose={() => setLists(null)} routine={home?.routine ?? null} start={lists ?? "templates"} />
      {!ro && <Capture open={capturing != null} mode={capturing ?? "scan"} onClose={() => setCapturing(null)} onType={typeInstead} />}
      <SmItemSheet itemId={openId} onClose={closeSheet} />
      <StoreMode open={shopping} onClose={() => setShopping(false)} onPickStore={() => setPicking(true)} />
      <AddScreen open={adding != null} mode={adding ?? "type"} hint={addHint} seed={addSeed} onClose={() => (setAdding(null), setAddHint(null), setAddSeed(null))} onCapture={(k) => (setAdding(null), capture(k))} />
    </>
  );
  const startBar = !ro && s.sm.length > 0 && !mineRunning && (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(90px+env(safe-area-inset-bottom))] z-30 desk:static desk:mt-2" data-sm-start-bar>
      <button type="button" className="pointer-events-auto flex h-14 w-full items-center justify-center gap-2.5 rounded-[18px] bg-ink text-[16px] font-extrabold text-bg shadow-[0_10px_28px_color-mix(in_srgb,var(--ink)_24%,transparent)] transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98]" onClick={() => setShopping(true)} data-sm-start>
        <ShoppingCart className="size-5" />
        {t.sm.start}
        <span className="tabular font-bold opacity-70">{s.sm.length}</span>
      </button>
    </div>
  );
  const firstTime = <FirstTime basketSize={Math.min(WEEKLY_BASKET_SIZE, basket.length)} onBasket={() => void addBasket(basket.slice(0, WEEKLY_BASKET_SIZE))} onBuild={() => setBasketOn(true)} onPaste={() => setAdding("paste")} />;
  const list = (
    <>
      {s.sm.length > 0 && <p className="tabular px-1 pt-1 text-[13px] font-semibold text-muted">{s.sm.length === 1 ? t.sm.main.itemsOne : f(t.sm.main.items, { n: s.sm.length })}</p>}
      {/* R18 S3 B3: one list — one surface with the section headers inside it (not a card per section). */}
      <div className="gro-one" data-sm-list>
        {groups.map(([k, list]) => (
          <Section key={k} section={k} items={list} tiles={shown === "tiles"} unitKg={home?.unitKg} />
        ))}
      </div>
    </>
  );
  const offer = !ro && home?.routine && <RoutineOffer routine={home.routine} />;
  const suggestions = <Suggestions home={home} basket={null} draft={draft} ro={ro} />;

  if (desk)
    return (
      <div className="flex flex-col gap-3 pb-10" data-sm-view data-sm-layout={shown} data-sm-desk>
        {header}
        <Badges viewer={viewer} />
        {overlays}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(300px,370px)] items-start gap-4">
          <div className="flex min-w-0 flex-col gap-3">
            {!ro && <AddField onOpen={openAdd} />}
            {first ? firstTime : list}
            {startBar}
          </div>
          <aside className="sticky top-4 flex min-w-0 flex-col gap-3" data-sm-side>
            <div className="rounded-[18px] border border-line-strong bg-surface p-3 shadow-card">
              <StoreLine home={home} store={trip.store} onPick={() => setPicking(true)} />
              {s.sm.length > 0 && (
                <div className="mt-3">
                  <Rail groups={groups} />
                </div>
              )}
            </div>
            {!first && offer}
            {!first && suggestions}
            <DeskTemplates ro={ro} onOpen={() => openLists("templates")} onSave={() => openLists("save")} />
            <DeskPast onOpen={() => s.setView({ type: "history", src: "sm" })} />
          </aside>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-3 pb-28" data-sm-view data-sm-layout={shown}>
      {header}
      <Badges viewer={viewer} />
      <StoreLine home={home} store={trip.store} onPick={() => setPicking(true)} />
      {overlays}
      {s.sm.length > 0 && <Rail groups={groups} />}
      {!ro && <AddField onOpen={openAdd} />}
      {startBar}
      {first ? (
        firstTime
      ) : (
        <>
          {/* R18 S3 B3: the list first; "Nexus suggests" under it (one line until opened); then the routine offer. */}
          {list}
          {suggestions}
          {offer}
        </>
      )}
    </div>
  );

  function closeSheet() {
    setOpenId(null);
  }

  /** B3: the scanner / the package photo. */
  function capture(k: "scan" | "photo") {
    setCapturing(k);
  }

  async function addBasket(items: BasketItem[]) {
    await addMany(items, { done: (n) => f(t.sm.main.addedN, { n }), failed: t.sm.main.failed });
  }
}

function Badges({ viewer }: { viewer: boolean }) {
  const s = useStore();
  const { t, f } = useI18n();
  const waiting = useOutboxCount();
  if (!viewer && s.offlineAt == null) return null;
  return (
    <div className="-mt-1 flex flex-wrap gap-1.5">
      {viewer && (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-[12.5px] font-semibold text-muted" data-sm-viewer>
          <Eye className="size-3.5" />
          {t.sm.main.viewOnly}
        </span>
      )}
      {s.offlineAt != null && (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-warn-soft px-2.5 text-[12.5px] font-semibold text-warn" data-sm-offline>
          <CloudOff className="size-3.5" />
          {waiting ? f(t.sm.main.offlineWaiting, { n: waiting }) : t.sm.main.offline}
        </span>
      )}
    </div>
  );
}

/** Store chip (chain monogram, chain, branch) + the list's estimate against what's left of this month's budget. */
function StoreLine({ home, store, onPick }: { home: SmHome | null; store: { chain: string; branch: string } | null; onPick: () => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const def = chainDef(store?.chain);
  const est = useEstimate(home);
  const left = useMonthLeft(home);
  const name = def ? (locale === "he" ? def.he : def.en) : store?.chain;
  const pct = est != null && left != null && left > 0 ? Math.min(1, est / left) : null;
  return (
    <div className="flex items-stretch gap-3">
      <button type="button" onClick={onPick} className="flex min-h-14 min-w-0 flex-1 items-center gap-2.5 rounded-[16px] border border-line-strong bg-surface px-2.5 text-start shadow-card transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98]" aria-label={store ? `${t.sm.main.changeStore}: ${name}` : t.sm.main.chooseStore} data-sm-store>
        {store ? (
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] text-[14px] font-extrabold text-white" style={{ background: def ? monoColor(def.color) : "var(--muted)" }}>
            {(locale === "he" ? def?.monoHe : def?.mono)?.slice(0, 1) ?? name?.slice(0, 1)}
          </span>
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-muted">
            <ShoppingBasket className="size-[18px]" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <b className="bidi block truncate text-[15px] font-extrabold">{store ? name : t.sm.main.chooseStore}</b>
          {store?.branch && <span className="bidi block truncate text-[12.5px] text-muted">{store.branch}</span>}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted" />
      </button>
      <div className="flex min-w-[118px] flex-col items-end justify-center gap-1 text-end" data-sm-estimate>
        <b className="tabular text-[19px] font-extrabold tracking-[-0.01em]">{est != null ? f(t.sm.main.estimate, { amount: formatMoney(Math.round(est), s.currency, locale) }) : "—"}</b>
        {left != null && (
          <>
            <span className="h-1 w-24 overflow-hidden rounded-full bg-line-in" aria-hidden>
              <i className={cn("block h-full rounded-full", left < 0 ? "bg-warn" : "bg-ink")} style={{ width: `${Math.round((pct ?? (left < 0 ? 1 : 0)) * 100)}%` }} />
            </span>
            <small className="tabular text-[11.5px] text-muted">{left >= 0 ? f(t.sm.main.leftMonth, { amount: formatMoney(Math.round(left), s.currency, locale) }) : f(t.sm.main.overMonth, { amount: formatMoney(Math.round(-left), s.currency, locale) })}</small>
          </>
        )}
      </div>
    </div>
  );
}

/** One bar per section on the list, in walking order, as wide as its count. */
function Rail({ groups }: { groups: readonly (readonly [string, ItemWithSources[]])[] }) {
  return (
    <div className="gro-rail" aria-hidden data-sm-rail>
      {groups.map(([k, list]) => (
        <i key={k} style={{ "--k": sectionColor(k), "--n": list.length } as React.CSSProperties} />
      ))}
    </div>
  );
}

/** The add field: opens the Add screen (B2) — typing, voice, scan / photo (B3). */
function AddField({ onOpen }: { onOpen: (mode: AddMode | "scan" | "photo") => void }) {
  const { t } = useI18n();
  const voice = useVoiceSupported();
  const icon = "grid size-10 shrink-0 place-items-center rounded-full text-ink transition-transform duration-150 ease-[var(--ease-out)] active:scale-90 [&_svg]:size-[19px] [&_svg]:stroke-[1.8]";
  return (
    <div className="flex h-14 items-center gap-1 rounded-[16px] border border-line-strong bg-surface pe-1.5 shadow-card" data-sm-add>
      <button type="button" className="flex h-full min-w-0 flex-1 items-center gap-2.5 ps-3.5 text-start text-[16px] text-muted" onClick={() => onOpen("type")} data-sm-add-open>
        <Plus className="size-[18px] shrink-0" />
        <span className="truncate">{t.sm.main.addPh}</span>
      </button>
      <button type="button" className={icon} aria-label={t.sm.main.scan} title={t.sm.main.scan} onClick={() => onOpen("scan")} data-sm-add-scan>
        <ScanBarcode />
      </button>
      <button type="button" className={icon} aria-label={t.sm.main.photo} title={t.sm.main.photo} onClick={() => onOpen("photo")} data-sm-add-photo>
        <Camera />
      </button>
      {voice && (
        <button type="button" className={icon} aria-label={t.sm.main.voice} title={t.sm.main.voice} onClick={() => onOpen("voice")} data-sm-add-voice>
          <Mic />
        </button>
      )}
    </div>
  );
}

/** "Nexus suggests" (or "Ready for Thursday" from the evening draft): + adds, × skips for this cycle, Add all. */
const SUG_OPEN_KEY = "nexus.smSugOpen";
function Suggestions({ home, basket, draft, ro }: { home: SmHome | null; basket: BasketItem[] | null; draft: boolean; ro: boolean }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  // R18 S3 B3: one line until opened on phones (open on a computer's side panel and for tonight's draft); the choice
  // is remembered on this device.
  const desk = useDevice() === "computer";
  const [open, setOpenState] = useState(desk || draft);
  useEffect(() => {
    try {
      const v = localStorage.getItem(SUG_OPEN_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the device's remembered choice (browser only)
      if (v === "1" || v === "0") setOpenState(v === "1" || draft);
    } catch {}
  }, [draft]);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem(SUG_OPEN_KEY, v ? "1" : "0");
    } catch {}
  };
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [acting, setActing] = useState<Sug | null>(null);
  const onList = useMemo(() => new Set(s.sm.map((i) => i.productKey).filter(Boolean)), [s.sm]);
  const list: Sug[] = useMemo(() => {
    const base: Sug[] = home?.suggestions ?? [];
    const extra: Sug[] = (basket ?? []).map((b) => ({ ...b, reasonKey: "basket" as const, reasonArgs: {}, quietUntil: 0 }));
    const seen = new Set<string>();
    return [...base, ...extra].filter((x) => !gone.has(x.productKey) && !onList.has(x.productKey) && !seen.has(x.productKey) && !!seen.add(x.productKey));
  }, [home, basket, gone, onList]);
  if (!list.length) return null;
  const reason = (x: Sug) => {
    const a = x.reasonArgs as Record<string, string | number>;
    if (x.reasonKey === "due") return Number(a.days) >= 14 ? f(t.sm.sug.dueWeeks, { weeks: Math.round(Number(a.days) / 7) }) : f(t.sm.sug.due, { days: a.days });
    if (x.reasonKey === "shabbat") return t.sm.sug.shabbat;
    if (x.reasonKey === "holiday") return (t.sm.sug.holiday as Record<string, string>)[String(a.holiday)] ?? String(a.holiday);
    if (x.reasonKey === "with") return f(t.sm.sug.with, { title: a.title });
    return t.sm.sug.basket;
  };
  const accept = async (xs: Sug[]) => {
    setGone((g) => new Set([...g, ...xs.map((x) => x.productKey)]));
    try {
      const rows = await acceptSuggestions(xs.map((x) => ({ productKey: x.productKey, title: x.title, qty: x.qty, amount: x.amount, unit: x.unit, section: x.section, art: x.art })));
      s.upsertSm(rows.map(asItem));
      if (xs.length > 1) toast.success(f(t.sm.main.addedN, { n: rows.length }));
    } catch {
      setGone((g) => new Set([...g].filter((k) => !xs.some((x) => x.productKey === k))));
      toast.error(t.sm.main.failed);
    }
  };
  const skip = (x: Sug) => {
    setGone((g) => new Set([...g, x.productKey]));
    if (x.reasonKey !== "basket") skipOnServer(x.productKey, x.quietUntil);
  };
  const day = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { weekday: "long", timeZone: s.clock.tz }).format(new Date(s.clock.now + 86_400_000));
  return (
    <section className="gro-sug" data-sm-suggest={open ? "open" : "closed"}>
      <SuggestionActions sug={acting} reason={acting ? reason(acting) : ""} onClose={() => setActing(null)} />
      <button type="button" className="flex min-h-[56px] w-full items-center gap-3 px-3.5 text-start" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t.sm.sug.open} data-sm-sug-toggle>
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-spark text-white">
          <Sparkles className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-[15.5px] font-extrabold">{draft ? f(t.sm.sug.readyFor, { day }) : t.sm.sug.title}</b>
          <span className="block truncate text-[12.5px] text-muted">{draft ? f(t.sm.sug.readySub, { n: list.length, m: s.sm.length }) : list.length === 1 ? t.sm.sug.subOne : f(t.sm.sug.sub, { n: list.length })}</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform duration-200 ease-[var(--ease-out)]", !open && "-rotate-90 rtl:rotate-90")} />
      </button>
      <div className="gro-sec-b" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
        <div>
          {list.map((x) => (
            <div key={x.productKey} className="gro-sug-row flex min-h-[64px] items-center gap-3 px-3.5 py-2" data-sm-sug={x.productKey}>
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-start" onClick={() => !ro && setActing(x)} aria-label={f(t.sm.sugAct.open, { title: x.title })} data-sm-sug-open>
              <ProductTile art={x.art} section={x.section} size={44} />
              <span className="min-w-0 flex-1">
                <b className="bidi block truncate text-[15px] font-extrabold">
                  {x.title} {x.unit && x.unit !== "u" && x.amount ? qtyLabel({ quantity: x.qty, amount: x.amount, unit: x.unit }, locale) : `×${x.qty}`}
                </b>
                <span className="block truncate text-[12.5px] text-muted">{reason(x)}</span>
              </span>
              </button>
              {!ro && (
                <>
                  <button type="button" className="grid size-10 shrink-0 place-items-center rounded-full text-muted transition-transform duration-150 ease-[var(--ease-out)] active:scale-90" aria-label={f(t.sm.sug.skip, { title: x.title })} onClick={() => skip(x)} data-sm-sug-skip>
                    <X className="size-[18px]" />
                  </button>
                  <button type="button" className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-ink text-bg transition-transform duration-150 ease-[var(--ease-out)] active:scale-90" aria-label={f(t.sm.sug.add, { title: x.title })} onClick={() => setActing(x)} data-sm-sug-add>
                    <Plus className="size-5" strokeWidth={2.4} />
                  </button>
                </>
              )}
            </div>
          ))}
          {!ro && (
            <div className="gro-sug-foot flex min-h-14 items-center gap-3 px-3.5 py-2">
              <span className="min-w-0 flex-1 text-[13px] text-muted">{t.sm.sug.foot}</span>
              <button type="button" className="h-10 shrink-0 rounded-[12px] bg-ink px-3.5 text-[14px] font-bold text-bg transition-transform duration-150 ease-[var(--ease-out)] active:scale-95" onClick={() => void accept(list)} data-sm-sug-all>
                {t.sm.sug.addAll}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** "Not this time": quiet until the end of the product's cycle (the server caps it at 120 days). */
function skipOnServer(productKey: string, until: number) {
  const now = Date.now();
  if (until > now) void dismissSuggestion(productKey, Math.min(until, now + 119 * 86_400_000)).catch(() => {});
}

function FirstTime({ basketSize, onBasket, onBuild, onPaste }: { basketSize: number; onBasket: () => void; onBuild: () => void; onPaste: () => void }) {
  const { t, f } = useI18n();
  const card = "flex min-h-[76px] w-full items-center gap-3.5 rounded-[18px] border border-line-strong bg-surface px-3.5 text-start shadow-card transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98]";
  const ART = ["produce", "dairy", "drink", "cans", "clean"];
  return (
    <div className="flex flex-col gap-3" data-sm-first>
      <div className="relative flex h-40 items-end justify-center gap-3 overflow-hidden rounded-[22px] border border-line bg-[radial-gradient(120%_90%_at_80%_20%,color-mix(in_srgb,var(--orange,#fb7a3c)_14%,var(--surface)),var(--surface))] pb-4" aria-hidden>
        {ART.map((k, i) => (
          <span key={k} className="grid w-11 place-items-center rounded-[12px] bg-surface shadow-card" style={{ height: [70, 96, 82, 60, 104][i] }}>
            <SectionIcon section={k} size={30} />
          </span>
        ))}
      </div>
      <h2 className="px-1 pt-1 text-[19px] font-extrabold">{t.sm.first.title}</h2>
      <button type="button" className={card} onClick={onBasket} data-sm-first-basket>
        <span className="grid size-11 shrink-0 place-items-center rounded-[13px] bg-surface-2 text-ink">
          <ShoppingBasket className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-[15.5px] font-extrabold">{t.sm.first.basket}</b>
          <span className="block text-[13px] text-muted">{f(t.sm.first.basketSub, { n: basketSize })}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" />
      </button>
      <button type="button" className={card} onClick={onBuild} data-sm-first-build>
        <span className="grid size-11 shrink-0 place-items-center rounded-[13px] bg-spark text-white">
          <Sparkles className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-[15.5px] font-extrabold">{t.sm.first.build}</b>
          <span className="block text-[13px] text-muted">{t.sm.first.buildSub}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" />
      </button>
      <button type="button" className={card} onClick={onPaste} data-sm-first-paste>
        <span className="grid size-11 shrink-0 place-items-center rounded-[13px] bg-surface-2 text-ink">
          <ClipboardPaste className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-[15.5px] font-extrabold">{t.sm.first.paste}</b>
          <span className="block text-[13px] text-muted">{t.sm.first.pasteSub}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" />
      </button>
    </div>
  );
}

function Section({ section, items, tiles, unitKg }: { section: string; items: ItemWithSources[]; tiles: boolean; unitKg?: Record<string, number> }) {
  const { t, f, locale } = useI18n();
  const [shut, setShut] = useState(false);
  const name = section === "other" ? t.sm.main.other : sectionName(section, locale);
  return (
    <section className="gro-sec" style={{ "--k": sectionColor(section) } as React.CSSProperties} data-shut={shut ? "" : undefined} data-sm-section={section}>
      <button type="button" className="gro-sec-h" onClick={() => setShut(!shut)} aria-expanded={!shut} aria-label={f(t.sm.main.sectionToggle, { section: name })}>
        <SectionIcon section={section} size={26} />
        <span className="gro-nm">{name}</span>
        <span className="gro-n">{items.length}</span>
        <ChevronDown className="gro-cv size-4" />
      </button>
      <div className="gro-sec-b">
        <div>
          {tiles ? (
            <div className="gro-tiles">
              {items.map((i) => (
                <Tile key={i.id} item={i} unitKg={i.productKey ? unitKg?.[i.productKey] ?? null : null} />
              ))}
            </div>
          ) : (
            <div className="gro-box">
              {items.map((i) => (
                <Row key={i.id} item={i} unitKg={i.productKey ? unitKg?.[i.productKey] ?? null : null} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Tile({ item, unitKg }: { item: ItemWithSources; unitKg: number | null }) {
  const { locale } = useI18n();
  return (
    <button type="button" className="gro-tile" onClick={() => openSmItem(item.id)} data-sm-row={item.id} data-settled={useSettled(item.id)}>
      <ProductTile art={item.artKey} section={item.section} photo={item.imageUrl} size={56} />
      <span className="gro-t bidi">{item.title}</span>
      <span className="gro-q">{qtyLabel(item, locale, unitKg)}</span>
    </button>
  );
}
