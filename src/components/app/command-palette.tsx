"use client";

import { useEffect } from "react";
import { Command } from "cmdk";
import { Dialog as D } from "radix-ui";
import { FolderPlus, Languages, LayoutGrid, Link2, ListPlus, Moon, Rows3, Search, ShoppingBag, History, Zap, Coins } from "lucide-react";
import { useTheme } from "next-themes";
import { useI18n } from "@/components/providers";
import { Kbd } from "@/components/ui/button";
import { CURRENCIES } from "@/lib/money";
import { ProductImage } from "./item-card";
import { useStore } from "./store";
import { COLLECTION_COLORS } from "./view-items";

const itemCls =
  "flex h-11 cursor-default select-none items-center gap-3 rounded-lg px-3 text-sm text-fg outline-none data-[selected=true]:bg-sunken [&_svg]:size-4 [&_svg]:text-muted";
const groupCls = "px-1.5 pb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-faint";

export function CommandPalette() {
  const s = useStore();
  const { t, locale, setLocale } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.setPaletteOpen(!s.paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s]);

  const run = (fn: () => void) => {
    s.setPaletteOpen(false);
    setTimeout(fn, 10);
  };

  return (
    <D.Root open={s.paletteOpen} onOpenChange={s.setPaletteOpen}>
      <D.Portal>
        <D.Overlay className="overlay-in fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <D.Content className="fixed inset-x-0 top-[10vh] z-50 mx-auto w-[calc(100vw-24px)] max-w-[600px] animate-pop-in overflow-hidden rounded-2xl border border-line bg-raised shadow-pop outline-none">
          <D.Title className="sr-only">{t.cmd.placeholder}</D.Title>
          <D.Description className="sr-only">{t.cmd.placeholder}</D.Description>
          <Command loop label={t.cmd.placeholder} className="flex max-h-[min(560px,75vh)] flex-col">
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 text-faint" />
              <Command.Input autoFocus placeholder={t.cmd.placeholder} className="h-13 flex-1 bg-transparent py-4 text-[15px] outline-none placeholder:text-faint" />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="overflow-y-auto p-1.5">
              <Command.Empty className="py-10 text-center text-sm text-muted">{t.cmd.noResults}</Command.Empty>

              <Command.Group heading={t.cmd.actions} className={groupCls}>
                <Command.Item value={`add ${t.cmd.addLink}`} onSelect={() => run(s.focusAdd)} className={itemCls}>
                  <Link2 /> {t.cmd.addLink}
                </Command.Item>
                <Command.Item value={`project ${t.nav.newProject}`} onSelect={() => run(() => s.setEditor({ mode: "create", kind: "project" }))} className={itemCls}>
                  <FolderPlus /> {t.nav.newProject}
                </Command.Item>
                <Command.Item value={`list ${t.nav.newList}`} onSelect={() => run(() => s.setEditor({ mode: "create", kind: "list" }))} className={itemCls}>
                  <ListPlus /> {t.nav.newList}
                </Command.Item>
                <Command.Item value={`layout ${t.view.cards} ${t.view.table}`} onSelect={() => run(() => s.setLayout(s.layout === "cards" ? "table" : "cards"))} className={itemCls}>
                  {s.layout === "cards" ? <Rows3 /> : <LayoutGrid />} {s.layout === "cards" ? t.view.table : t.view.cards}
                </Command.Item>
                <Command.Item value={`theme dark light ${t.cmd.toggleTheme}`} onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))} className={itemCls}>
                  <Moon /> {t.cmd.toggleTheme}
                </Command.Item>
                <Command.Item value={`language hebrew english ${t.cmd.switchLang}`} onSelect={() => run(() => setLocale(locale === "en" ? "he" : "en"))} className={itemCls}>
                  <Languages /> {t.cmd.switchLang}
                </Command.Item>
                {CURRENCIES.filter((c) => c !== s.currency).map((c) => (
                  <Command.Item key={c} value={`currency ${c}`} onSelect={() => run(() => s.setCurrency(c))} className={itemCls}>
                    <Coins /> {t.settings.currency} {c}
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading={t.cmd.collections} className={groupCls}>
                <Command.Item value={`view ${t.nav.toBuy}`} onSelect={() => run(() => s.setView({ type: "to_buy" }))} className={itemCls}>
                  <ShoppingBag /> {t.nav.toBuy}
                </Command.Item>
                <Command.Item value={`view ${t.nav.urgent}`} onSelect={() => run(() => s.setView({ type: "urgent" }))} className={itemCls}>
                  <Zap /> {t.nav.urgent}
                </Command.Item>
                <Command.Item value={`view ${t.nav.history}`} onSelect={() => run(() => s.setView({ type: "history" }))} className={itemCls}>
                  <History /> {t.nav.history}
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
                    <span className="min-w-0 flex-1 truncate" dir="auto">
                      {i.title}
                    </span>
                    <span className="shrink-0 text-xs text-faint">{i.status === "purchased" ? t.nav.history : i.sources[0]?.store}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
