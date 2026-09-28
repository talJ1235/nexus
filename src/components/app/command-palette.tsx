"use client";

import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { Dialog as D } from "radix-ui";
import { FolderPlus, Languages, LayoutGrid, Link2, ListPlus, Moon, Rows3, Search, ShoppingBag, History, Zap, Coins, Settings2, Sun, Monitor, Puzzle, LogOut, Store, Truck, ChartColumn, FileSpreadsheet, Download, Bell, Sparkles, Wand2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useI18n } from "@/components/providers";
import { Kbd } from "@/components/ui/button";
import { CURRENCIES } from "@/lib/money";
import { ProductImage } from "./item-card";
import { useStore } from "./store";
import { COLLECTION_COLORS } from "./view-items";
import { Segmented } from "./settings-dialog";
import type { Currency } from "@/lib/money";

const itemCls =
  "flex h-11 cursor-default select-none items-center gap-3 rounded-lg px-3 text-sm text-fg outline-none data-[selected=true]:bg-sunken [&_svg]:size-4 [&_svg]:text-muted";
const groupCls = "px-1.5 pb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-faint";

/** Word-aware matching: "sett" finds "Open settings", not every value that happens to contain s-e-t-t. */
function paletteFilter(value: string, search: string) {
  const q = search.toLowerCase().trim();
  if (!q) return 1;
  const v = value.toLowerCase();
  const words = q.split(/\s+/);
  if (!words.every((w) => v.includes(w))) return 0;
  const wordStarts = words.every((w) => new RegExp(`(^|[\\s/,.-])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(v));
  return wordStarts ? 1 : 0.5;
}

export function CommandPalette() {
  const s = useStore();
  const { t, locale, setLocale } = useI18n();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [search, setSearch] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.setPaletteOpen(!s.paletteOpen);
        return;
      }
      // Esc opens the palette when nothing else is open (Esc inside any dialog still closes that dialog).
      if (e.key === "Escape" && !e.defaultPrevented && !s.paletteOpen) {
        if (document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]')) return;
        // With items selected, the first Esc just clears the selection.
        if (s.selected.size) {
          s.clearSelection();
          return;
        }
        const el = e.target as HTMLElement | null;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
          const v = (el as HTMLInputElement).value;
          if (v) return; // Esc in a filled field just leaves it alone
          el.blur();
        }
        e.preventDefault();
        s.setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s]);

  const run = (fn: () => void) => {
    s.setPaletteOpen(false);
    setSearch("");
    setTimeout(fn, 10);
  };

  return (
    <D.Root
      open={s.paletteOpen}
      onOpenChange={(o) => {
        s.setPaletteOpen(o);
        if (!o) setSearch("");
      }}
    >
      <D.Portal>
        <D.Overlay className="overlay-in fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <D.Content className="fixed inset-x-0 top-[10vh] z-50 mx-auto w-[calc(100vw-24px)] max-w-[600px] animate-pop-in overflow-hidden rounded-2xl border border-line bg-raised shadow-pop outline-none">
          <D.Title className="sr-only">{t.cmd.placeholder}</D.Title>
          <D.Description className="sr-only">{t.cmd.placeholder}</D.Description>
          <Command loop filter={paletteFilter} label={t.cmd.placeholder} className="flex max-h-[min(560px,75vh)] flex-col">
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 text-faint" />
              <Command.Input autoFocus value={search} onValueChange={setSearch} placeholder={t.cmd.placeholder} className="h-13 flex-1 bg-transparent py-4 text-[15px] outline-none placeholder:text-faint" />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="overflow-y-auto p-1.5">
              <Command.Empty className="py-10 text-center text-sm text-muted">{t.cmd.noResults}</Command.Empty>

              {s.aiEnabled && search.trim().length > 2 && (
                <Command.Group heading={t.ai.title} className={groupCls} forceMount>
                  <Command.Item value={`ask ${search}`} forceMount onSelect={() => run(() => s.askAssistant(search.trim()))} className={itemCls}>
                    <Sparkles className="!text-accent-ink" />
                    <span className="min-w-0 truncate">
                      {t.ai.askPalette}: <span className="text-muted">“{search.trim()}”</span>
                    </span>
                  </Command.Item>
                </Command.Group>
              )}

              <Command.Group heading={t.cmd.actions} className={groupCls}>
                <Command.Item value={`add ${t.cmd.addLink}`} onSelect={() => run(s.focusAdd)} className={itemCls}>
                  <Link2 /> {t.cmd.addLink}
                </Command.Item>
                {s.aiEnabled && (
                  <Command.Item value={`plan project ai parts bom ${t.ai.planTab}`} onSelect={() => run(() => s.setPanel("planner"))} className={itemCls}>
                    <Wand2 /> {t.ai.planTab}
                  </Command.Item>
                )}
                <Command.Item value={`project ${t.nav.newProject}`} onSelect={() => run(() => s.setEditor({ mode: "create", kind: "project" }))} className={itemCls}>
                  <FolderPlus /> {t.nav.newProject}
                </Command.Item>
                <Command.Item value={`list ${t.nav.newList}`} onSelect={() => run(() => s.setEditor({ mode: "create", kind: "list" }))} className={itemCls}>
                  <ListPlus /> {t.nav.newList}
                </Command.Item>
                <Command.Item value={`layout ${t.view.cards} ${t.view.table}`} onSelect={() => run(() => s.setLayout(s.layout === "cards" ? "table" : "cards"))} className={itemCls}>
                  {s.layout === "cards" ? <Rows3 /> : <LayoutGrid />} {s.layout === "cards" ? t.view.table : t.view.cards}
                </Command.Item>
              </Command.Group>

              <Command.Group heading={t.settings.title} className={groupCls}>
                <Command.Item value={`settings preferences ${t.settings.open}`} onSelect={() => run(() => s.setSettingsOpen(true))} className={itemCls}>
                  <Settings2 /> {t.settings.open}
                </Command.Item>
                <Command.Item value={`theme dark light ${t.cmd.toggleTheme}`} onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))} className={itemCls}>
                  {resolvedTheme === "dark" ? <Sun /> : <Moon />} {t.cmd.toggleTheme}
                </Command.Item>
                <Command.Item value={`theme system ${t.settings.theme} ${t.settings.system}`} onSelect={() => run(() => setTheme("system"))} className={itemCls}>
                  <Monitor /> {t.settings.theme}: {t.settings.system}
                </Command.Item>
                <Command.Item value={`language hebrew english ${t.cmd.switchLang}`} onSelect={() => run(() => setLocale(locale === "en" ? "he" : "en"))} className={itemCls}>
                  <Languages /> {t.cmd.switchLang}
                </Command.Item>
                {CURRENCIES.filter((c) => c !== s.currency).map((c) => (
                  <Command.Item key={c} value={`currency ${c}`} onSelect={() => run(() => s.setCurrency(c))} className={itemCls}>
                    <Coins /> {t.settings.currency} {c}
                  </Command.Item>
                ))}
                <Command.Item value={`alerts price telegram notifications ${t.alerts.title}`} onSelect={() => run(() => s.setPanel("alerts"))} className={itemCls}>
                  <Bell /> {t.alerts.title}
                </Command.Item>
                <Command.Item value={`import excel csv spreadsheet ${t.io.importSheet}`} onSelect={() => run(() => s.setPanel("import"))} className={itemCls}>
                  <FileSpreadsheet /> {t.io.importSheet}
                </Command.Item>
                <Command.Item
                  value={`backup export download ${t.io.backup}`}
                  onSelect={() =>
                    run(() => {
                      // A file download, not a page navigation.
                      const a = document.createElement("a");
                      a.href = "/api/backup";
                      a.download = "";
                      a.click();
                    })
                  }
                  className={itemCls}
                >
                  <Download /> {t.io.backup}
                </Command.Item>
                <Command.Item value={`extension clipper chrome ${t.settings.extension}`} onSelect={() => run(() => s.setExtOpen(true))} className={itemCls}>
                  <Puzzle /> {t.settings.extension}
                </Command.Item>
                <Command.Item
                  value={`logout sign out ${t.nav.signOut}`}
                  onSelect={() =>
                    run(() => {
                      const f = document.createElement("form");
                      f.method = "post";
                      f.action = "/api/logout";
                      document.body.appendChild(f);
                      f.submit();
                    })
                  }
                  className={itemCls}
                >
                  <LogOut /> {t.nav.signOut}
                </Command.Item>
              </Command.Group>

              <Command.Group heading={t.cmd.collections} className={groupCls}>
                <Command.Item value={`view ${t.nav.toBuy}`} onSelect={() => run(() => s.setView({ type: "to_buy" }))} className={itemCls}>
                  <ShoppingBag /> {t.nav.toBuy}
                </Command.Item>
                <Command.Item value={`view ${t.nav.urgent}`} onSelect={() => run(() => s.setView({ type: "urgent" }))} className={itemCls}>
                  <Zap /> {t.nav.urgent}
                </Command.Item>
                <Command.Item value={`view orders store ${t.nav.orders}`} onSelect={() => run(() => s.setView({ type: "orders" }))} className={itemCls}>
                  <Store /> {t.nav.orders}
                </Command.Item>
                <Command.Item value={`view ordered shipping tracking ${t.nav.onTheWay}`} onSelect={() => run(() => s.setView({ type: "ordered" }))} className={itemCls}>
                  <Truck /> {t.nav.onTheWay}
                </Command.Item>
                <Command.Item value={`view ${t.nav.history}`} onSelect={() => run(() => s.setView({ type: "history" }))} className={itemCls}>
                  <History /> {t.nav.history}
                </Command.Item>
                <Command.Item value={`view spending dashboard ${t.nav.spending}`} onSelect={() => run(() => s.setView({ type: "spending" }))} className={itemCls}>
                  <ChartColumn /> {t.nav.spending}
                </Command.Item>
                {s.collections.map((c) => (
                  <Command.Item key={c.id} value={`collection ${c.name} ${c.id}`} onSelect={() => run(() => s.setView({ type: "collection", id: c.id }))} className={itemCls}>
                    <span className={c.kind === "project" ? "size-2.5 rounded-[3px]" : "size-2.5 rounded-full"} style={{ background: COLLECTION_COLORS[c.color] }} />
                    {c.name}
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading={t.cmd.items} className={groupCls}>
                {s.items.slice(0, 400).map((i) => (
                  <Command.Item
                    key={i.id}
                    value={`${i.title} ${i.brand ?? ""} ${(i.tags ?? []).join(" ")} ${i.sources.map((x) => x.store).join(" ")} ${i.id}`}
                    onSelect={() => run(() => s.openItem(i.id))}
                    className={itemCls}
                  >
                    <ProductImage src={i.imageUrl} alt="" className="size-7 shrink-0 rounded-md" iconClass="size-3.5" />
                    <span className="min-w-0 flex-1 truncate bidi">
                      {i.title}
                    </span>
                    <span className="shrink-0 text-xs text-faint">{i.status === "purchased" ? t.flow.received : i.status === "ordered" ? t.flow.ordered : i.sources[0]?.store}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>

          {/* Quick settings: always visible the moment the palette opens; changes apply live. */}
          <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface/60 px-3 py-2.5">
            <Segmented
              size="sm"
              label={t.settings.theme}
              value={(theme ?? "system") as "system" | "dark" | "light"}
              onChange={setTheme}
              options={[
                { value: "system", label: <Monitor />, title: `${t.settings.theme}: ${t.settings.system}` },
                { value: "dark", label: <Moon />, title: `${t.settings.theme}: ${t.settings.dark}` },
                { value: "light", label: <Sun />, title: `${t.settings.theme}: ${t.settings.light}` },
              ]}
            />
            <Segmented<Currency>
              size="sm"
              label={t.settings.currency}
              value={s.currency}
              onChange={s.setCurrency}
              options={CURRENCIES.map((c) => ({ value: c, label: c === "ILS" ? "₪" : c === "USD" ? "$" : "€", title: `${t.settings.currency} ${c}` }))}
            />
            <Segmented
              size="sm"
              label={t.settings.language}
              value={locale}
              onChange={(l) => l !== locale && setLocale(l)}
              options={[
                { value: "en", label: "EN", title: "English" },
                { value: "he", label: "עב", title: "עברית" },
              ]}
            />
            <button
              type="button"
              onClick={() => run(() => s.setSettingsOpen(true))}
              className="ms-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted transition hover:bg-sunken hover:text-fg [&_svg]:size-4"
            >
              <Settings2 />
              {t.settings.title}
            </button>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
