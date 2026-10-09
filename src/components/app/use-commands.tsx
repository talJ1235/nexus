"use client";

import { Bell, ChartColumn, Coins, Download, FileSpreadsheet, FolderPlus, History, House, Inbox, Languages, LayoutGrid, Link2, ListPlus, LogOut, MessageSquareWarning, Monitor, Moon, Puzzle, ReceiptText, Rows3, ScanBarcode, Settings2, ShieldCheck, ShoppingBag, ShoppingCart, Sparkles, Store, Sun, Truck, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useI18n } from "@/components/providers";
import { usePalette } from "@/components/use-palette";
import { setAiSuggestions } from "@/app/home-actions";
import type { AppCommand } from "@/lib/commands";
import { download, exportUrl } from "@/lib/export-url";
import { CURRENCIES } from "@/lib/money";
import { PALETTES } from "@/lib/palette";
import { toast } from "@/lib/toast";
import { PaletteSwatch } from "./settings-dialog";

const SETTINGS_SECTIONS = ["account", "display", "ai", "calendar", "memory", "data", "general", "people", "budget", "danger"] as const;
import { useStore } from "./store";
import { PHONE, useMedia } from "@/components/ui/use-media";

function postForm(action: string) {
  const f = document.createElement("form");
  f.method = "post";
  f.action = action;
  document.body.appendChild(f);
  f.submit();
}

/**
 * Every action, setting and view the app can jump to (Round 13 C1) — the desktop command menu (Ctrl K / Esc) and the
 * phone search use this one list. `run` does the thing; callers close their own surface first.
 */
export function useCommands(): AppCommand[] {
  const s = useStore();
  const router = useRouter();
  const phone = useMedia(PHONE);
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const [palette, setPalette] = usePalette();
  const aiOn = s.homePrefs.aiSuggestions;
  const cmds: AppCommand[] = [
    // Actions
    { id: "add", group: "actions", label: t.cmd.addLink, keywords: "add link url paste הוספה קישור", icon: <Link2 />, run: () => (window.matchMedia("(max-width: 1023px)").matches ? s.setPasteOpen(true) : s.focusAdd()) },
    { id: "receipt", group: "actions", label: t.scan.title, keywords: "receipt invoice order confirmation purchased קבלה חשבונית", icon: <ReceiptText />, run: () => s.openReceipt() },
    { id: "shop", group: "actions", label: t.shop.title, keywords: "shopping mode store supermarket list קנייה סופר", icon: <ShoppingCart />, run: () => s.setShop("pick"), testId: "shop" },
    { id: "barcode", group: "actions", label: t.barcode.title, keywords: "scan barcode ean upc ברקוד סריקה", icon: <ScanBarcode />, run: () => s.setScanner("barcode") },
    ...(s.aiEnabled ? [{ id: "plan", group: "actions" as const, label: t.ai.planTab, keywords: "plan project ai parts bom תכנון", icon: <Wand2 />, run: () => s.setPanel("planner") }] : []),
    { id: "new-project", group: "actions", label: t.nav.newProject, keywords: "project new פרויקט חדש", icon: <FolderPlus />, run: () => s.setEditor({ mode: "create", kind: "project" }) },
    { id: "new-list", group: "actions", label: t.nav.newList, keywords: "list new רשימה חדשה", icon: <ListPlus />, run: () => s.setEditor({ mode: "create", kind: "list" }) },
    // R14 A4: on a phone this is List / Grid (phoneLayout); the desktop Cards / Table pref is never touched there.
    phone
      ? { id: "layout", group: "actions", label: s.phoneLayout === "rows" ? t.view.cards : t.view.rows, keywords: `layout ${t.view.cards} ${t.view.rows} ${t.view.table}`, icon: s.phoneLayout === "rows" ? <LayoutGrid /> : <Rows3 />, run: () => s.setPhoneLayout(s.phoneLayout === "rows" ? "cards" : "rows") }
      : { id: "layout", group: "actions", label: s.layout === "cards" ? t.view.table : t.view.cards, keywords: `layout ${t.view.cards} ${t.view.table}`, icon: s.layout === "cards" ? <Rows3 /> : <LayoutGrid />, run: () => s.setLayout(s.layout === "cards" ? "table" : "cards") },
    // Settings
    { id: "settings", group: "settings", label: t.settings.open, keywords: "settings preferences הגדרות", icon: <Settings2 />, run: () => s.setSettingsOpen(true), testId: "open-settings" },
    // R17 G0: the admin panel (admin only).
    ...(s.admin ? [{ id: "admin", group: "settings" as const, label: t.adm.entry, keywords: "admin panel people live reports system ניהול אדמין", icon: <ShieldCheck />, run: () => router.push("/admin"), testId: "open-admin" }] : []),
    // R16 D1: one entry per section (deep link /settings/<section>).
    ...SETTINGS_SECTIONS.filter((id) => s.space?.kind === "shared" || (id !== "people" && id !== "danger")).map((id) => ({
      id: `settings-${id}`,
      group: "settings" as const,
      label: `${t.sx.title}: ${t.sx.sections[id]}`,
      keywords: `settings ${t.sx.keywords[id]} הגדרות`,
      icon: <Settings2 />,
      run: () => s.openSettings(id),
    })),
    ...(["light", "dark", "system"] as const).map((m) => ({
      id: `theme-${m}`,
      group: "settings" as const,
      label: `${t.settings.theme}: ${t.settings[m]}`,
      keywords: `theme mode appearance ${m} ${m === "dark" ? "night כהה" : m === "light" ? "day בהיר" : "auto מערכת"} ערכת נושא`,
      icon: m === "light" ? <Sun /> : m === "dark" ? <Moon /> : <Monitor />,
      run: () => setTheme(m),
      active: (theme ?? "system") === m,
      control: "theme" as const,
    })),
    ...PALETTES.map((p) => ({
      id: `palette-${p}`,
      group: "settings" as const,
      label: `${t.settings.palette}: ${t.settings[p]}`,
      keywords: `palette colors colours ${p} צבעים`,
      icon: <PaletteSwatch palette={p} />,
      run: () => setPalette(p),
      active: palette === p,
      control: "palette" as const,
    })),
    { id: "language", group: "settings", label: t.cmd.switchLang, keywords: "language hebrew english שפה עברית אנגלית", icon: <Languages />, run: () => setLocale(locale === "en" ? "he" : "en"), control: "language" },
    ...CURRENCIES.map((c) => ({
      id: `currency-${c}`,
      group: "settings" as const,
      label: `${t.settings.currency} ${c}`,
      keywords: `currency money ${c} ${c === "ILS" ? "shekel ₪ שקל" : c === "USD" ? "dollar $ דולר" : "euro € יורו"} מטבע`,
      icon: <Coins />,
      run: () => s.setCurrency(c),
      active: s.currency === c,
      control: "currency" as const,
    })),
    {
      id: "ai-suggestions",
      group: "settings",
      label: `${t.dash.aiSetting}: ${aiOn ? "✓" : "—"}`,
      keywords: "ai suggestions assistant home wording templates בינה הצעות עוזר",
      icon: <Sparkles />,
      active: aiOn,
      control: "ai",
      run: () => {
        const before = s.homePrefs;
        s.setHomePrefs({ ...before, aiSuggestions: !aiOn });
        toast.success(!aiOn ? t.dash.aiOn : t.dash.aiOff);
        setAiSuggestions(!aiOn).catch(() => s.setHomePrefs(before));
      },
    },
    { id: "alerts", group: "settings", label: t.alerts.title, keywords: "alerts price notifications התראות", icon: <Bell />, run: () => s.setPanel("alerts") },
    {
      id: "export",
      group: "settings",
      label: t.me.export,
      keywords: "export excel xlsx bom download ייצוא אקסל",
      icon: <FileSpreadsheet />,
      run: () => download(exportUrl(s.view.type === "collection" ? { collection: s.view.id } : { view: s.view.type === "history" ? "history" : s.view.type === "to_buy" && s.view.f ? (s.view.f === "urgent" ? "urgent" : "unsorted") : "to_buy" }, s.currency, locale)),
      testId: "export",
    },
    { id: "import", group: "settings", label: t.io.importSheet, keywords: "import excel csv spreadsheet ייבוא", icon: <FileSpreadsheet />, run: () => s.setPanel("import") },
    {
      id: "backup",
      group: "settings",
      label: t.io.backup,
      keywords: "backup export download גיבוי",
      icon: <Download />,
      run: () => {
        // A file download, not a page navigation.
        const a = document.createElement("a");
        a.href = "/api/backup";
        a.download = "";
        a.click();
      },
    },
    { id: "report", group: "settings", label: t.report.menu, keywords: "report problem bug complaint idea feedback דיווח תקלה", icon: <MessageSquareWarning />, run: () => s.openReport(), testId: "report" },
    { id: "reports", group: "settings", label: t.report.reports, keywords: "reports bugs issues דיווחים", icon: <Inbox />, run: () => s.setReportsOpen(true), testId: "reports" },
    { id: "logout", group: "settings", label: t.nav.signOut, keywords: "logout sign out יציאה", icon: <LogOut />, run: () => postForm("/api/logout") },
    // Views
    { id: "view-home", group: "views", label: t.dash.title, keywords: "view home dashboard בית לוח", icon: <House />, run: () => s.setView({ type: "home" }) },
    { id: "view-to_buy", group: "views", label: t.nav.toBuy, keywords: "view to buy shopping", icon: <ShoppingBag />, run: () => s.setView({ type: "to_buy" }) },
    { id: "view-orders", group: "views", label: t.nav.orders, keywords: "view orders store", icon: <Store />, run: () => s.setView({ type: "orders" }) },
    { id: "view-ordered", group: "views", label: t.nav.onTheWay, keywords: "view ordered shipping tracking", icon: <Truck />, run: () => s.setView({ type: "ordered" }) },
    { id: "view-history", group: "views", label: t.nav.history, keywords: "view history", icon: <History />, run: () => s.setView({ type: "history" }) },
    { id: "view-spending", group: "views", label: t.nav.spending, keywords: "view spending dashboard", icon: <ChartColumn />, run: () => s.setView({ type: "spending" }) },
  ];
  return cmds;
}
