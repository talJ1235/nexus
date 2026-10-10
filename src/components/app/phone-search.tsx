"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Clock, Coins, History, Folder, Languages, Link2, Monitor, Moon, ReceiptText, ScanBarcode, Settings2, Sparkles, Store as StoreIcon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useI18n } from "@/components/providers";
import { usePalette } from "@/components/use-palette";
import { matchCommands, matchScore, type AppCommand } from "@/lib/commands";
import { lineTotal } from "@/lib/calc";
import { CURRENCIES, formatMoney, type Currency } from "@/lib/money";
import { PALETTES } from "@/lib/palette";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProductImage } from "./item-card";
import { AiSuggestionsSwitch, PaletteSwatch, Segmented } from "./settings-dialog";
import { useStore } from "./store";
import { useCommands } from "./use-commands";
import { COLLECTION_COLORS } from "./view-items";

const RECENT_KEY = "nexus.recentSearches";
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}
export function rememberSearch(q: string) {
  const v = q.trim();
  if (v.length < 2) return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([v, ...readRecent().filter((x) => x !== v)].slice(0, 6)));
  } catch {}
}

const noop = () => () => {};
const useMounted = () => useSyncExternalStore(noop, () => true, () => false);

/** What an item is found by: its words, brand, tags, stores, project and the category in both languages. */
function itemHay(i: ItemWithSources, cat: Record<string, string>, project: string | null) {
  return [i.title, i.brand, ...(i.tags ?? []), ...i.sources.map((x) => x.store), project, i.category, i.category ? cat[i.category] : null].filter(Boolean).join(" ");
}

/**
 * Phone search (Round 13 C1): one search for items, projects, stores, settings and actions — the same commands as the
 * desktop command menu. Typing shows grouped results (Settings & actions first, with theme / palette / currency /
 * language / AI controls working in place), then Items, Projects, Stores and "Ask Nexus about …". Empty: recent
 * searches + 4 quick actions. Rendered under the top bar (portal), above the page.
 */
export function PhoneSearchResults({ q, onClose, onPick }: { q: string; onClose: () => void; onPick: (q: string) => void }) {
  const mounted = useMounted();
  if (!mounted) return null;
  return createPortal(<Results q={q} onClose={onClose} onPick={onPick} />, document.body);
}

function Results({ q, onClose, onPick }: { q: string; onClose: () => void; onPick: (q: string) => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const cmds = useCommands();
  const query = q.trim();
  const [recent, setRecent] = useState(readRecent);
  const cat = t.categories as Record<string, string>;

  const res = useMemo(() => {
    if (!query) return null;
    const commands = matchCommands(cmds, query).filter((c) => c.group !== "views");
    const views = matchCommands(cmds, query).filter((c) => c.group === "views");
    const projectName = (id: string | null) => (id ? s.collections.find((c) => c.id === id)?.name ?? null : null);
    const items = s.items
      .map((i) => ({ i, sc: matchScore(itemHay(i, cat, projectName(i.collectionId)), query) }))
      .filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc || Number(a.i.status !== "to_buy") - Number(b.i.status !== "to_buy") || b.i.createdAt - a.i.createdAt)
      .map((x) => x.i);
    const projects = s.collections.filter((c) => !c.archived && matchScore(c.name, query) > 0);
    const stores = new Map<string, { key: string; name: string; n: number }>();
    for (const i of s.items)
      for (const src of i.sources)
        if (matchScore(src.store, query) > 0) {
          const e = stores.get(src.storeKey) ?? { key: src.storeKey, name: src.store, n: 0 };
          if (i.status === "to_buy") e.n++;
          stores.set(src.storeKey, e);
        }
    const bought = items.filter((i) => i.status === "purchased").length;
    return { commands, views, items, projects, bought, stores: [...stores.values()].slice(0, 4) };
  }, [query, cmds, s.items, s.collections, cat]);

  const go = (fn: () => void) => {
    if (query) rememberSearch(query);
    onClose();
    setTimeout(fn, 30);
  };
  // R17 A3: Settings covers the screen — open it in the same frame the search closes (no Home in between).
  const openSettings = () => {
    if (query) rememberSearch(query);
    s.setSettingsOpen(true);
    onClose();
  };
  const row = "flex min-h-[56px] w-full items-center gap-3 px-3.5 py-2 text-start";
  const chip = "grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink [&_svg]:size-[18px]";

  return (
    <div className="fixed inset-x-0 bottom-0 top-[var(--app-header-h,74px)] z-[19] overflow-y-auto overscroll-contain bg-bg px-3 pb-[calc(120px+env(safe-area-inset-bottom))] pt-1 lg:hidden" data-phone-search-results role="region" aria-label={t.view.search}>
      {!res ? (
        <>
          {recent.length > 0 && (
            <Group title={t.search.recent} id="recent" action={<button type="button" className="text-[12px] font-semibold text-muted" onClick={() => (localStorage.removeItem(RECENT_KEY), setRecent([]))}>{t.search.clearRecent}</button>}>
              {recent.map((r) => (
                <button key={r} type="button" className={cn(row, "min-h-[46px]")} onClick={() => onPick(r)} data-search-recent>
                  <Clock className="size-4 shrink-0 text-muted" />
                  <span className="bidi min-w-0 flex-1 truncate text-[14px]">{r}</span>
                </button>
              ))}
            </Group>
          )}
          <Group title={t.search.quick} id="quick">
            {[
              { k: "paste", icon: <Link2 />, label: t.phone.paste, run: () => s.setPasteOpen(true) },
              { k: "barcode", icon: <ScanBarcode />, label: t.phone.barcode, run: () => s.setScanner("barcode") },
              { k: "receipt", icon: <ReceiptText />, label: t.phone.receipt, run: () => s.setScanner("receipt") },
              { k: "settings", icon: <Settings2 />, label: t.search.openAll, run: () => s.setSettingsOpen(true) },
            ].map((a) => (
              <button key={a.k} type="button" className={row} onClick={() => (a.k === "settings" ? openSettings() : go(a.run))} data-search-quick={a.k}>
                <span className={chip}>{a.icon}</span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{a.label}</span>
              </button>
            ))}
          </Group>
          <p className="px-1.5 pt-1 text-[12px] leading-relaxed text-muted">{t.search.hint}</p>
        </>
      ) : (
        <>
          {res.commands.length + res.views.length > 0 && (
            <Group title={t.search.settingsActions} id="settings">
              <CommandRows cmds={[...res.commands, ...res.views]} q={query} go={go} />
              <button type="button" className={row} onClick={openSettings} data-search-open-settings>
                <span className={chip}>
                  <Settings2 />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block text-[14px] font-semibold">{t.search.openAll}</b>
                  <span className="block truncate text-[12px] text-muted">{t.search.openAllHint}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" />
              </button>
            </Group>
          )}
          {res.bought > 0 && (
            <button
              type="button"
              onClick={() =>
                go(() => {
                  s.setView({ type: "history" });
                  s.setHistoryQuery(query);
                })
              }
              className="r13-card mt-3 flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-start"
              data-go-history
            >
              <History className="size-[18px] shrink-0 text-muted" />
              <span className="min-w-0 flex-1 text-[14px] text-muted">{res.bought === 1 ? t.insights.inHistoryOne : f(t.insights.inHistory, { n: res.bought })}</span>
              <b className="shrink-0 text-[14px] font-bold">{t.insights.goHistory}</b>
            </button>
          )}
          {res.items.length > 0 && (
            <Group title={`${t.search.items} · ${res.items.length}`} id="items">
              {res.items.slice(0, 8).map((i) => {
                const project = i.collectionId ? s.collections.find((c) => c.id === i.collectionId) : null;
                const price = lineTotal(i, s.rates, s.currency);
                return (
                  <button key={i.id} type="button" className={row} onClick={() => go(() => s.openItem(i.id))} data-search-item={i.id}>
                    <ProductImage src={i.imageUrl} alt="" className="size-10 shrink-0 rounded-lg border border-line-in" iconClass="size-5" />
                    <span className="min-w-0 flex-1">
                      <b className="bidi block truncate text-[14px] font-semibold">
                        <Mark text={i.title} q={query} />
                      </b>
                      <span className="block truncate text-[12px] text-muted">{[project?.name, i.sources[0]?.store, price != null ? formatMoney(Math.round(price), s.currency, locale) : null].filter(Boolean).join(" · ")}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" />
                  </button>
                );
              })}
            </Group>
          )}
          {res.projects.length > 0 && (
            <Group title={t.search.projects} id="projects">
              {res.projects.slice(0, 5).map((c) => (
                <button key={c.id} type="button" className={row} onClick={() => go(() => s.setView({ type: "collection", id: c.id }))} data-search-project={c.id}>
                  <span className={chip}>
                    <Folder style={{ color: COLLECTION_COLORS[c.color] }} />
                  </span>
                  <span className="bidi min-w-0 flex-1 truncate text-[14px] font-semibold">
                    <Mark text={c.name} q={query} />
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" />
                </button>
              ))}
            </Group>
          )}
          {res.stores.length > 0 && (
            <Group title={t.search.stores} id="stores">
              {res.stores.map((x) => (
                <button key={x.key} type="button" className={row} onClick={() => go(() => s.setView({ type: "store", key: x.key }))} data-search-store={x.key}>
                  <span className={chip}>
                    <StoreIcon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="bidi block truncate text-[14px] font-semibold">
                      <Mark text={x.name} q={query} />
                    </b>
                    <span className="block text-[12px] text-muted">{x.n === 1 ? t.search.storeItemsOne : f(t.search.storeItems, { n: x.n })}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" />
                </button>
              ))}
            </Group>
          )}
          {!res.commands.length && !res.views.length && !res.items.length && !res.projects.length && !res.stores.length && (
            <p className="px-1.5 py-4 text-center text-[13.5px] text-muted">{f(t.search.none, { q: query })}</p>
          )}
          {s.aiEnabled && query.length > 1 && (
            <Group title={t.search.askGroup} id="ask">
              <button type="button" className={row} onClick={() => go(() => s.askAssistant(query))} data-search-ask>
                <span className={cn(chip, "text-ai")}>
                  <Sparkles />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="bidi block truncate text-[14px] font-semibold">{f(t.search.askAbout, { q: query })}</b>
                  <span className="block truncate text-[12px] text-muted">{t.search.askHint}</span>
                </span>
              </button>
            </Group>
          )}
        </>
      )}
    </div>
  );
}

function Group({ title, id, action, children }: { title: string; id: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-3" data-search-group={id}>
      <div className="flex items-center justify-between px-1.5 pb-1.5">
        <h3 className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted">{title}</h3>
        {action}
      </div>
      <div className="r13-card r13-rows overflow-hidden">{children}</div>
    </section>
  );
}

/** The typed words, highlighted in a result's name. */
function Mark({ text, q }: { text: string; q: string }) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, k) =>
        words.includes(part.toLowerCase()) ? (
          <mark key={k} className="rounded-[3px] bg-tint px-0.5 text-tint-ink">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * Matching commands. Theme / palette / currency / language collapse into one row each with the control in place
 * (changes apply at once, the search stays open); the AI switch too; other commands are rows that run and close.
 */
function CommandRows({ cmds, q, go }: { cmds: AppCommand[]; q: string; go: (fn: () => void) => void }) {
  const s = useStore();
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const [palette, setPalette] = usePalette();
  const seen = new Set<string>();
  const row = "flex min-h-[56px] w-full items-center gap-3 px-3.5 py-2 text-start";
  const chip = "grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink [&_svg]:size-[18px]";
  const ctrl = (key: string, icon: React.ReactNode, title: React.ReactNode, sub: string, control: React.ReactNode) => (
    <div key={key} className={row} data-search-control={key}>
      <span className={chip}>{icon}</span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[14px] font-semibold">{title}</b>
        <span className="block truncate text-[12px] text-muted">{sub}</span>
      </span>
      {control}
    </div>
  );
  return (
    <>
      {cmds.map((c) => {
        if (c.control) {
          if (seen.has(c.control)) return null;
          seen.add(c.control);
          switch (c.control) {
            case "theme": {
              const cur = (theme ?? "system") as "system" | "dark" | "light";
              return ctrl(
                "theme",
                cur === "dark" ? <Moon /> : cur === "light" ? <Sun /> : <Monitor />,
                <>
                  {t.settings.theme}: <Mark text={t.settings[cur]} q={q} />
                </>,
                t.search.settingsSub,
                <Segmented
                  size="touch"
                  label={t.settings.theme}
                  value={cur}
                  onChange={setTheme}
                  options={[
                    { value: "light", label: <Sun />, title: t.settings.light },
                    { value: "dark", label: <Moon />, title: t.settings.dark },
                    { value: "system", label: <Monitor />, title: t.settings.system },
                  ]}
                />,
              );
            }
            case "palette":
              return ctrl("palette", <PaletteSwatch palette={palette} />, `${t.settings.palette}: ${t.settings[palette]}`, t.search.settingsSub, <Segmented size="touch" label={t.settings.palette} value={palette} onChange={setPalette} options={PALETTES.map((p) => ({ value: p, label: <PaletteSwatch palette={p} />, title: t.settings[p] }))} />);
            case "currency":
              return ctrl(
                "currency",
                <Coins />,
                `${t.settings.currency}: ${s.currency}`,
                t.search.currencySub,
                <Segmented<Currency> size="touch" label={t.settings.currency} value={s.currency} onChange={s.setCurrency} options={CURRENCIES.map((x) => ({ value: x, label: x === "ILS" ? "₪" : x === "USD" ? "$" : "€", title: x }))} />,
              );
            case "language":
              return ctrl(
                "language",
                <Languages />,
                t.settings.language,
                t.search.languageSub,
                <Segmented size="touch" label={t.settings.language} value={locale} onChange={(l) => l !== locale && setLocale(l)} options={[{ value: "en", label: "EN", title: "English" }, { value: "he", label: "עב", title: "עברית" }]} />,
              );
            case "ai":
              return ctrl("ai", <Sparkles />, t.dash.aiSetting, t.search.aiSub, <AiSuggestionsSwitch />);
          }
        }
        if (c.id === "settings") return null; // "Open all settings" is the group's last row
        return (
          <button key={c.id} type="button" className={row} onClick={() => go(c.run)} data-search-cmd={c.id}>
            <span className={chip}>{c.icon}</span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
              <Mark text={c.label} q={q} />
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" />
          </button>
        );
      })}
    </>
  );
}

