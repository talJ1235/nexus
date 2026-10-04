"use client";

import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { Dialog as D } from "radix-ui";
import { FolderPlus, Languages, LayoutGrid, Link2, ListPlus, Moon, Rows3, Search, ShoppingBag, History, Zap, Coins, Settings2, Sun, Monitor, Puzzle, LogOut, Store, Truck, ChartColumn, FileSpreadsheet, Download, Bell, Sparkles, Wand2, ReceiptText, Check, ScanBarcode, ShoppingCart, MessageSquareWarning, Inbox, FolderInput, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useI18n } from "@/components/providers";
import { Kbd } from "@/components/ui/button";
import { CURRENCIES } from "@/lib/money";
import { download, exportUrl } from "@/lib/export-url";
import { ProductImage } from "./item-card";
import { openItemActions, SHORTCUT, StatusIcon, useItemActions } from "./quick-actions";
import { useStore } from "./store";
import { COLLECTION_COLORS } from "./view-items";
import { PaletteSwatch, Segmented } from "./settings-dialog";
import { usePalette } from "@/components/use-palette";
import { PALETTES } from "@/lib/palette";
import { matchScore } from "@/lib/commands";
import { useCommands } from "./use-commands";
import type { Currency } from "@/lib/money";

const itemCls =
  "flex h-11 cursor-default select-none items-center gap-3 rounded-lg px-3 text-sm text-fg outline-none data-[selected=true]:bg-sunken [&_svg]:size-4 [&_svg]:text-muted";
const groupCls = "px-1.5 pb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-faint";

/** Word-aware matching (lib/commands, shared with the phone search): "sett" finds "Open settings". */
const paletteFilter = matchScore;

export function CommandPalette() {
  const s = useStore();
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const [palette, setPalette] = usePalette();
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

  const acts = useItemActions();
  const cmds = useCommands();
  const chosen = s.selected.size ? s.items.filter((i) => s.selected.has(i.id)) : [];
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

              {chosen.length > 0 && (
                // Round 11 C2: the quick actions on the selected items, with their keys.
                <Command.Group heading={`${t.quick.selectedGroup} (${chosen.length})`} className={groupCls} data-cmd-selected>
                  {(["ordered", "purchased"] as const).map((x) => (
                    <Command.Item key={x} value={`selected ${x} ${x === "ordered" ? t.quick.onTheWay : t.quick.received}`} onSelect={() => run(() => void acts.setStatus(chosen, x))} className={itemCls}>
                      <StatusIcon status={x} /> <span className="flex-1">{x === "ordered" ? t.quick.onTheWay : t.quick.received}</span> <Kbd>{SHORTCUT[x]}</Kbd>
                    </Command.Item>
                  ))}
                  <Command.Item value={`selected move ${t.quick.move}`} onSelect={() => run(() => openItemActions(chosen.map((i) => i.id), "move"))} className={itemCls}>
                    <FolderInput /> <span className="flex-1">{t.quick.move}</span> <Kbd>{SHORTCUT.move}</Kbd>
                  </Command.Item>
                  <Command.Item value={`selected delete ${t.quick.delete}`} onSelect={() => run(() => void acts.remove(chosen))} className={itemCls}>
                    <Trash2 /> <span className="flex-1">{t.quick.delete}</span> <Kbd>{SHORTCUT.delete}</Kbd>
                  </Command.Item>
                </Command.Group>
              )}

              {(["actions", "settings"] as const).map((g) => (
                <Command.Group key={g} heading={g === "actions" ? t.cmd.actions : t.settings.title} className={groupCls}>
                  {cmds
                    .filter((c) => c.group === g)
                    .map((c) => (
                      <Command.Item key={c.id} value={`${c.keywords} ${c.label} ${c.id}`} onSelect={() => run(c.run)} className={itemCls} {...(c.testId ? { [`data-cmd-${c.testId}`]: "" } : {})}>
                        {c.icon} {c.label}
                        {c.active && c.control !== "ai" && <Check className="ms-auto !size-3.5 !text-muted" />}
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}

              <Command.Group heading={t.cmd.collections} className={groupCls}>
                {cmds
                  .filter((c) => c.group === "views")
                  .map((c) => (
                    <Command.Item key={c.id} value={`${c.keywords} ${c.label}`} onSelect={() => run(c.run)} className={itemCls}>
                      {c.icon} {c.label}
                    </Command.Item>
                  ))}
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
            <Segmented
              size="sm"
              label={t.settings.palette}
              value={palette}
              onChange={setPalette}
              options={PALETTES.map((p) => ({ value: p, label: <PaletteSwatch palette={p} />, title: `${t.settings.palette}: ${t.settings[p]}` }))}
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
