"use client";

import { ChainLogo } from "./store-picker";
import "./sm.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Camera, ChevronDown, ChevronRight, ClipboardPaste, CloudOff, Eye, History, LayoutList, ListOrdered, Mic, MoreHorizontal, Plus, ScanBarcode, ShoppingBasket, ShoppingCart, Sparkles, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlays";
import { acceptSuggestions, dismissSuggestion, seenSwipeHint, setSupermarketLayout } from "@/app/supermarket-actions";
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
import { AddedPill, announceAdded, useAddedLine, type Added } from "./added";
import { useOutboxCount } from "./outbox-count";
import { EmptyTemplates, Lists, RoutineOffer, type ListsStart } from "./lists";
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
  // S4 D2: rows keep the order they were added in — a row Undo puts back returns to its place, not the section's end.
  for (const i of [...items].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))) {
    const k = i.section && order.includes(i.section) ? i.section : "other";
    m.set(k, [...(m.get(k) ?? []), i]);
  }
  return [...order, "other"].filter((k) => m.has(k)).map((k) => [k, m.get(k)!] as const);
}

const noSub = () => () => {};

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
  // S4 D3: docked once the slot after the list reaches the floating bar's place (90 px above the bottom).
  // R19 A6: read from the slot's box on every scroll / resize / layout change — an IntersectionObserver only reports
  // threshold crossings, so a tab opened at the previous tab's scroll (slot above the screen → "docked") and then reset
  // to the top (slot below the screen: still not intersecting, no callback) kept the bar docked out of sight.
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);
  const hydrated = useSyncExternalStore(noSub, () => true, () => false);
  const [docked, setDocked] = useState(false);
  const deskView = useDevice() === "computer";
  useLayoutEffect(() => {
    if (!slotEl || deskView) return;
    // Docked only while the slot is wholly on screen above the bar's line; scrolled past it (open suggestions under the
    // list), the bar floats again — the view's 170 px end padding keeps the last content clear of it.
    const now = () => {
      const r = slotEl.getBoundingClientRect();
      setDocked(r.top >= 0 && r.bottom <= window.innerHeight - 90);
    };
    let f = 0;
    const soon = () => {
      cancelAnimationFrame(f);
      f = requestAnimationFrame(now);
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first read, before paint
    now();
    window.addEventListener("scroll", now, { passive: true });
    window.addEventListener("resize", soon);
    const ro = new ResizeObserver(soon);
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(f);
      window.removeEventListener("scroll", now);
      window.removeEventListener("resize", soon);
      ro.disconnect();
    };
  }, [slotEl, deskView]);
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
  const [capturing, setCapturing] = useState<"scan" | "photo" | "receipt" | null>(null);
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
    // R18 S5 A4: a list pasted anywhere on the page (not into a field) opens the paste review with its lines.
    const paste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text || /^https?:\/\//i.test(text) || el?.closest?.("input, textarea, [contenteditable], [role=dialog]")) return;
      e.preventDefault();
      setAddSeed(text);
      setAdding("paste");
    };
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("keydown", k);
      window.removeEventListener("paste", paste);
    };
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
      if (k === "scan" || k === "photo" || k === "receipt") setCapturing(k);
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
      <AddedPill paused={adding != null || capturing != null || shopping || lists != null} />
      <StorePicker open={picking} onClose={() => setPicking(false)} />
      <SectionOrder open={ordering} onClose={() => setOrdering(false)} onPickStore={() => setPicking(true)} />
      <Lists open={lists != null} onClose={() => setLists(null)} routine={home?.routine ?? null} start={lists ?? "templates"} />
      {!ro && <Capture open={capturing != null} mode={capturing ?? "scan"} onClose={() => setCapturing(null)} onType={typeInstead} />}
      <SmItemSheet itemId={openId} onClose={closeSheet} />
      <StoreMode open={shopping} onClose={() => setShopping(false)} onPickStore={() => setPicking(true)} />
      <AddScreen open={adding != null} mode={adding ?? "type"} hint={addHint} seed={addSeed} onClose={() => (setAdding(null), setAddHint(null), setAddSeed(null))} onCapture={(k) => (setAdding(null), capture(k))} />
    </>
  );
  const showStart = !ro && s.sm.length > 0 && !mineRunning;
  // R18 S5 C2: floating, it shares the floating Ask's row (bottom = dock + 12) and ends before it, on its side.
  const askGap = s.aiEnabled ? 82 : 12;
  const askLeft = s.homePrefs.askSide === "left";
  // R19 A6: floating, the bar lives in document.body (like the dock) — a tab's entrance slide (a transform on the view)
  // would otherwise make `fixed` relative to the view and carry the bar off screen while it plays.
  const startBarEl = showStart && (
    <div
      className={cn("pointer-events-none z-30 desk:static desk:mt-2", docked ? "relative" : "fixed bottom-[calc(92px+env(safe-area-inset-bottom))]")}
      style={docked || desk ? undefined : { left: askLeft ? askGap : 12, right: askLeft ? 12 : askGap }}
      data-sm-start-bar={docked ? "docked" : "floating"}
    >
      <button type="button" className={cn("pointer-events-auto flex h-14 w-full items-center justify-center gap-2.5 rounded-[18px] bg-ink text-[16px] font-extrabold text-bg transition-[transform,box-shadow] duration-200 ease-[var(--ease-out)] active:scale-[0.98]", docked ? "shadow-card" : "shadow-[0_10px_28px_color-mix(in_srgb,var(--ink)_24%,transparent)]")} onClick={() => setShopping(true)} data-sm-start>
        <ShoppingCart className="size-5" />
        {t.sm.start}
        <span className="tabular font-bold opacity-70">{s.sm.length}</span>
      </button>
    </div>
  );
  const startBar = startBarEl && (docked || desk || !hydrated ? startBarEl : createPortal(startBarEl, document.body));
  const firstTime = <FirstTime basketSize={Math.min(WEEKLY_BASKET_SIZE, basket.length)} onBasket={() => void addBasket(basket.slice(0, WEEKLY_BASKET_SIZE))} onBuild={() => setBasketOn(true)} onPaste={() => setAdding("paste")} />;
  // R18 S5 A2: the first time (per person) the first row peeks once and a line names both swipes.
  const hint = !ro && !desk && shown === "rows" && s.sm.length > 0 && !!home?.swipeHint;
  const list = (
    <>
      {hint && <SwipeHint />}
      {/* R18 S5 A1: one card for the whole list; sections are slim sticky bands inside it. */}
      <div className="gro-one" role="list" data-sm-list>
        {groups.map(([k, list], gi) => (
          <Section key={k} section={k} items={list} tiles={shown === "tiles"} unitKg={home?.unitKg} peek={hint && gi === 0} />
        ))}
      </div>
    </>
  );
  const offer = !ro && home?.routine && <RoutineOffer routine={home.routine} />;
  const suggestions = <Suggestions home={home} basket={null} draft={draft} ro={ro} />;
  // A3: nothing on the list (after the first time) — the suggestions open, under the templates.
  const empty = !first && s.sm.length === 0;
  const emptySuggestions = <Suggestions home={home} basket={null} draft={draft} ro={ro} forceOpen />;

  if (desk)
    return (
      <div className="flex flex-col gap-3 pb-10" data-sm-view data-sm-layout={shown} data-sm-desk>
        {header}
        <Badges viewer={viewer} />
        {overlays}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(300px,370px)] items-start gap-4">
          <div className="flex min-w-0 flex-col gap-3">
            {/* R18 S5 A4 (board List-desktop): one panel — the store + this list's count and estimate, the add field
                (a pasted list works anywhere on the page), then the list. */}
            <section className="gro-panel" data-sm-panel>
              <div className="flex items-center gap-3 px-4 pb-3 pt-4">
                <DeskStore store={trip.store} onPick={() => setPicking(true)} />
                <DeskCount home={home} />
              </div>
              {!ro && <DeskAdd onOpen={() => setAdding("type")} onMode={openAdd} />}
              {!first && !empty && list}
            </section>
            {(first || empty) && <EmptyTemplates ro={ro} />}
            {first ? firstTime : empty ? emptySuggestions : null}
            {startBar}
          </div>
          <aside className="sticky top-4 flex min-w-0 flex-col gap-3" data-sm-side>
            <ThisList home={home} groups={groups} />
            {!first && offer}
            {!first && !empty && suggestions}
            <DeskTemplates ro={ro} onOpen={() => openLists("templates")} onSave={() => openLists("save")} />
            <DeskPast onOpen={() => s.setView({ type: "history", src: "sm" })} />
          </aside>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-3 pb-[calc(170px+env(safe-area-inset-bottom))]" data-sm-view data-sm-layout={shown}>
      {header}
      <Badges viewer={viewer} />
      {/* R18 S5 A1: the store row (chain badge, branch, chevron) and one summary line — items · estimate · month left. */}
      <div className="-mt-1 flex flex-col">
        <StoreRow store={trip.store} onPick={() => setPicking(true)} />
        <SumRow home={home} />
      </div>
      {overlays}
      {!ro && !empty && <AddField onOpen={openAdd} />}
      {first ? (
        <>
          <EmptyTemplates ro={ro} />
          {firstTime}
        </>
      ) : empty ? (
        <>
          {/* R18 S4 A3: an empty list — templates first, then what the home usually buys, then the ways to add. */}
          <EmptyTemplates ro={ro} />
          {emptySuggestions}
          {!ro && <AddField onOpen={openAdd} />}
          {offer}
        </>
      ) : (
        <>
          {/* R18 S3 B3: the list first; "Nexus suggests" under it (one line until opened); then the routine offer.
              S4 D3: Start shopping floats above the dock until the list's end reaches it, then sits in its slot here. */}
          {list}
          {showStart && (
            <div ref={setSlotEl} className="h-14" data-sm-start-slot>
              {startBar}
            </div>
          )}
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

/** R18 S5 A1 (phone): the store row — chain badge, chain + branch, a chevron → change store. */
function StoreRow({ store, onPick }: { store: { chain: string; branch: string } | null; onPick: () => void }) {
  const { t, locale } = useI18n();
  const def = chainDef(store?.chain);
  const name = def ? (locale === "he" ? def.he : def.en) : store?.chain;
  return (
    <button type="button" onClick={onPick} className="flex h-[52px] w-full items-center gap-2.5 rounded-[16px] px-1.5 text-start transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98]" aria-label={store ? `${t.sm.main.changeStore}: ${name}` : t.sm.main.chooseStore} data-sm-store>
      {store ? (
        // R19 A10: the chain's real logo (or a plain store tile) — no letters.
        <ChainLogo chain={store.chain} size={36} />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-surface-2 text-muted">
          <ShoppingBasket className="size-[18px]" />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <b className="bidi truncate text-[15px] font-extrabold">{store ? name : t.sm.main.chooseStore}</b>
        {store?.branch && <span className="bidi truncate text-[12.5px] text-muted">{store.branch}</span>}
      </span>
      <ChevronDown className="size-4 shrink-0 text-muted" />
    </button>
  );
}

/** R18 S5 A1 (phone): "14 items · about ₪412 ▬▬ ₪1,180 left this month". */
function SumRow({ home }: { home: SmHome | null }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const est = useEstimate(home);
  const left = useMonthLeft(home);
  if (!s.sm.length) return null;
  const pct = est != null && left != null && left > 0 ? Math.min(1, est / left) : left != null && left < 0 ? 1 : null;
  const money = (n: number) => formatMoney(Math.round(n), s.currency, locale);
  return (
    <div className="tabular flex min-w-0 items-center gap-2 px-1.5 pb-0.5 text-[13px] text-muted" data-sm-estimate data-sm-sum>
      <span className="shrink-0 whitespace-nowrap">
        <b className="font-extrabold text-ink">{s.sm.length}</b> {s.sm.length === 1 ? t.sm.main.itemWord : t.sm.main.itemsWord}
        {est != null && (
          <>
            {" · "}
            <b className="font-extrabold text-ink">{f(t.sm.main.about, { amount: money(est) })}</b>
          </>
        )}
      </span>
      {left != null && (
        <>
          <span className="h-1.5 min-w-6 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <i className={cn("block h-full rounded-full transition-[width] duration-[400ms] ease-[var(--ease-out)]", left < 0 ? "bg-warn" : "bg-ok")} style={{ width: `${Math.round((pct ?? 0) * 100)}%` }} />
          </span>
          <span className="min-w-0 truncate whitespace-nowrap">{left >= 0 ? f(t.sm.main.leftMonth, { amount: money(left) }) : f(t.sm.main.overMonth, { amount: money(-left) })}</span>
        </>
      )}
    </div>
  );
}

/** R18 S5 A4: the computer panel's store button (a bordered chip) — chain badge, chain + branch, chevron. */
function DeskStore({ store, onPick }: { store: { chain: string; branch: string } | null; onPick: () => void }) {
  return (
    <div className="w-fit max-w-[60%] rounded-[16px] border border-line-strong pe-1">
      <StoreRow store={store} onPick={onPick} />
    </div>
  );
}

/** A4: "14 · ₪412" at the panel's end. */
function DeskCount({ home }: { home: SmHome | null }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const est = useEstimate(home);
  if (!s.sm.length) return null;
  return (
    <span className="tabular ms-auto shrink-0 text-[14px] text-muted" data-sm-estimate>
      <b className="font-extrabold text-ink">{s.sm.length}</b> {s.sm.length === 1 ? t.sm.main.itemWord : t.sm.main.itemsWord}
      {est != null && (
        <>
          {" · "}
          <b className="font-extrabold text-ink">{f(t.sm.main.about, { amount: formatMoney(Math.round(est), s.currency, locale) })}</b>
        </>
      )}
    </span>
  );
}

/** A4: the add field — type, or paste a whole list (Ctrl+V anywhere on the page). */
function DeskAdd({ onOpen, onMode }: { onOpen: () => void; onMode: (m: AddMode | "scan" | "photo") => void }) {
  const { t } = useI18n();
  const voice = useVoiceSupported();
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const icon = "grid size-10 shrink-0 place-items-center rounded-full text-ink transition-transform duration-150 ease-[var(--ease-out)] active:scale-90 hover:bg-surface-2 [&_svg]:size-[18px] [&_svg]:stroke-[1.8]";
  // The field + Ctrl+V (the board); voice, scan and photo stay one click away on a computer too.
  return (
    <div className="px-4 pb-3">
      <div className="flex h-12 w-full items-center gap-1 rounded-[14px] border border-line-strong bg-surface pe-1" data-sm-add>
        <button type="button" className="flex h-full min-w-0 flex-1 items-center gap-2.5 ps-3.5 text-start text-[15px] text-muted" onClick={onOpen} data-sm-add-open>
          <Plus className="size-[18px] shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t.sm.main.addPhDesk}</span>
          <kbd className="shrink-0 rounded-full border border-line-strong px-2 py-0.5 font-sans text-[12px] font-semibold text-muted">{mac ? "⌘V" : "Ctrl+V"}</kbd>
        </button>
        {voice && (
          <button type="button" className={icon} aria-label={t.sm.main.voice} title={t.sm.main.voice} onClick={() => onMode("voice")} data-sm-add-voice>
            <Mic />
          </button>
        )}
        <button type="button" className={icon} aria-label={t.sm.main.scan} title={t.sm.main.scan} onClick={() => onMode("scan")} data-sm-add-scan>
          <ScanBarcode />
        </button>
        <button type="button" className={icon} aria-label={t.sm.main.photo} title={t.sm.main.photo} onClick={() => onMode("photo")} data-sm-add-photo>
          <Camera />
        </button>
      </div>
    </div>
  );
}

/** A4: "This list" — the estimate, the split by section (the aisle rail), what's left of the month. */
function ThisList({ home, groups }: { home: SmHome | null; groups: readonly (readonly [string, ItemWithSources[]])[] }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const est = useEstimate(home);
  const left = useMonthLeft(home);
  const money = (n: number) => formatMoney(Math.round(n), s.currency, locale);
  const month = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { month: "long", timeZone: s.clock.tz }).format(new Date(s.clock.now));
  const budget = left != null && home ? left + (home.monthSpent ?? 0) : null;
  const usedPct = budget && budget > 0 && left != null ? Math.max(0, Math.min(1, left / budget)) : 0;
  return (
    <section className="gro-panel p-4" data-sm-this-list>
      <span className="text-[13.5px] font-semibold text-muted">{t.sm.main.thisList}</span>
      <b className="tabular mt-0.5 block text-[30px] font-extrabold leading-tight tracking-[-0.02em]" data-sm-this-est>
        {est != null ? money(est) : "—"}
      </b>
      {groups.length > 0 && (
        <div className="mt-3">
          <Rail groups={groups} />
        </div>
      )}
      {left != null && (
        <>
          <div className="mt-3 flex items-baseline justify-between gap-2 text-[13.5px]">
            <span className="text-muted">{t.sm.main.leftIn.replace("{month}", month)}</span>
            <b className={cn("tabular font-extrabold", left < 0 && "text-warn")}>{left < 0 ? `−${money(-left)}` : money(left)}</b>
          </div>
          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <i className={cn("block h-full rounded-full", left < 0 ? "bg-warn" : "bg-ok")} style={{ width: `${Math.round((left < 0 ? 1 : usedPct) * 100)}%` }} />
          </span>
        </>
      )}
    </section>
  );
}

/** R18 S5 A2: the one-time hint line (the first row peeks at the same time); marked seen once it has shown. */
function SwipeHint() {
  const { t } = useI18n();
  useEffect(() => {
    const id = setTimeout(() => void seenSwipeHint().catch(() => {}), 2600);
    return () => clearTimeout(id);
  }, []);
  return (
    <p className="gro-hint" data-sm-swipe-hint>
      <span className="gro-kb">
        <ArrowLeft className="size-3.5 rtl:-scale-x-100" />
        {t.sm.row.hintDel}
      </span>
      <span className="gro-kb">
        {t.sm.row.hintQty}
        <ArrowRight className="size-3.5 rtl:-scale-x-100" />
      </span>
      <span>{t.sm.row.hintName}</span>
    </p>
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
  const desk = useDevice() === "computer";
  const icon = "grid size-10 shrink-0 place-items-center rounded-full text-ink transition-transform duration-150 ease-[var(--ease-out)] active:scale-90 [&_svg]:size-[19px] [&_svg]:stroke-[1.8]";
  // R18 S5 A1 (board List-phone): phones show voice + the camera (it opens on the barcode, Photo is one tab away);
  // computers keep scan and photo apart.
  return (
    <div className="flex h-[52px] items-center gap-1 rounded-[16px] bg-surface pe-1.5 shadow-[inset_0_0_0_1px_var(--line),0_1px_2px_color-mix(in_srgb,var(--ink)_6%,transparent)]" data-sm-add>
      <button type="button" className="flex h-full min-w-0 flex-1 items-center gap-2.5 ps-3.5 text-start text-[16px] text-muted" onClick={() => onOpen("type")} data-sm-add-open>
        <Plus className="size-[18px] shrink-0" />
        <span className="truncate">{t.sm.main.addPh}</span>
      </button>
      {voice && (
        <button type="button" className={icon} aria-label={t.sm.main.voice} title={t.sm.main.voice} onClick={() => onOpen("voice")} data-sm-add-voice>
          <Mic />
        </button>
      )}
      {desk ? (
        <>
          <button type="button" className={icon} aria-label={t.sm.main.scan} title={t.sm.main.scan} onClick={() => onOpen("scan")} data-sm-add-scan>
            <ScanBarcode />
          </button>
          <button type="button" className={icon} aria-label={t.sm.main.photo} title={t.sm.main.photo} onClick={() => onOpen("photo")} data-sm-add-photo>
            <Camera />
          </button>
        </>
      ) : (
        <button type="button" className={icon} aria-label={t.sm.main.camera} title={t.sm.main.camera} onClick={() => onOpen("scan")} data-sm-add-scan data-sm-add-camera>
          <Camera />
        </button>
      )}
    </div>
  );
}

/** "Nexus suggests" (or "Ready for Thursday" from the evening draft): + adds, × skips for this cycle, Add all. */
const SUG_OPEN_KEY = "nexus.smSugOpen";
function Suggestions({ home, basket, draft, ro, forceOpen = false }: { home: SmHome | null; basket: BasketItem[] | null; draft: boolean; ro: boolean; forceOpen?: boolean }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const addedLine = useAddedLine();
  // R18 S3 B3: one line until opened on phones (open on a computer's side panel and for tonight's draft); the choice
  // is remembered on this device.
  const desk = useDevice() === "computer";
  const [openState, setOpenState] = useState(desk || draft);
  const open = openState || forceOpen;
  useEffect(() => {
    try {
      const v = localStorage.getItem(SUG_OPEN_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the device's remembered choice (browser only)
      if (v === "1" || v === "0") setOpenState(v === "1" || draft);
    } catch {}
  }, [draft]);
  // R19 A7: opening is one soft push — height on a gentle ease-in-out whose length follows the height (≈ 320 ms for a
  // few rows, ≤ 520 ms for many, so no frame moves what's below by more than ~24 px), the rows rise in 30 ms apart.
  const body = useRef<HTMLDivElement>(null);
  const [motion, setMotion] = useState<{ ms: number; rows: boolean }>({ ms: 320, rows: false });
  const setOpen = (v: boolean) => {
    const h = body.current?.scrollHeight ?? 0;
    setMotion({ ms: Math.round(Math.min(520, Math.max(v ? 320 : 220, h * (v ? 1.3 : 0.7)))), rows: v });
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
      const had = new Set(s.sm.map((i) => i.id));
      s.upsertSm(rows.map(asItem));
      const added: Added[] = rows.map((r) => ({ id: r.id, title: r.title, qty: qtyLabel(r, locale, home?.unitKg?.[r.productKey ?? ""] ?? null), merged: had.has(r.id) }));
      announceAdded(added, { line: addedLine(added) });
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
    <section className={cn("gro-sug", motion.rows && "gro-sug-anim")} data-sm-suggest={open ? "open" : "closed"}>
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
      <div className="gro-sec-b gro-sug-b" style={{ gridTemplateRows: open ? "1fr" : "0fr", transitionDuration: `${motion.ms}ms` }}>
        <div ref={body}>
          {list.map((x, i) => (
            <div key={x.productKey} className="gro-sug-row flex min-h-[64px] items-center gap-3 px-3.5 py-2" style={{ "--i": Math.min(i, 8) } as React.CSSProperties} data-sm-sug={x.productKey}>
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
            <div className="gro-sug-foot flex min-h-14 items-center gap-3 px-3.5 py-2" style={{ "--i": Math.min(list.length, 9) } as React.CSSProperties}>
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

/** R18 S5 A1: a section = a slim sticky band (colour dot, name, count) and its rows (or tiles) inside the list's card. */
function Section({ section, items, tiles, unitKg, peek }: { section: string; items: ItemWithSources[]; tiles: boolean; unitKg?: Record<string, number>; peek?: boolean }) {
  const { t, locale } = useI18n();
  const name = section === "other" ? t.sm.main.other : sectionName(section, locale);
  return (
    <section className="gro-sec" style={{ "--k": sectionColor(section) } as React.CSSProperties} aria-label={name} data-sm-section={section}>
      <div className="gro-band" data-sm-band>
        <span className="gro-dot" aria-hidden />
        <span className="gro-nm">{name}</span>
        <span className="gro-n">{items.length}</span>
      </div>
      {tiles ? (
        <div className="gro-tiles">
          {items.map((i) => (
            <Tile key={i.id} item={i} unitKg={i.productKey ? unitKg?.[i.productKey] ?? null : null} />
          ))}
        </div>
      ) : (
        <div className="gro-box">
          {items.map((i, k) => (
            <Row key={i.id} item={i} unitKg={i.productKey ? unitKg?.[i.productKey] ?? null : null} peek={peek && k === 0} />
          ))}
        </div>
      )}
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
