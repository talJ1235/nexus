"use client";

import { FileSpreadsheet, FolderPlus, Link2, ListPlus, ReceiptText, ScanBarcode, Sparkles, type LucideIcon } from "lucide-react";
import { useI18n } from "@/components/providers";
import { useReadOnly } from "./offline-banner";
import { BarcodeArt, LinkArt, PlanArt, ReceiptArt } from "./phone-shell";
import { useStore } from "./store";

export type AddAction = {
  key: "paste" | "barcode" | "receipt" | "plan" | "import" | "list" | "project";
  title: string;
  /** Shorter label for the phone's compact row. */
  short?: string;
  hint?: string;
  icon: LucideIcon;
  /** Big cards (phone "+", empty Home) get an illustration and a colour tone; the rest are compact rows. */
  art?: React.ReactNode;
  tone?: string;
  primary: boolean;
  kbd?: string;
  disabled: boolean;
  run: () => void;
};

const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;

/**
 * R16 A3 — the one list of "ways to add" (phone "+" sheet, empty Home, desktop Add menu). Each action knows its
 * phone and desktop behaviour (camera vs dialog, the paste field vs the add bar).
 */
export function useAddActions(): AddAction[] {
  const s = useStore();
  const { t } = useI18n();
  const ro = useReadOnly();
  const actions: AddAction[] = [
    { key: "barcode", icon: ScanBarcode, art: <BarcodeArt />, tone: "barcode", title: t.phone.barcode, hint: t.phone.barcodeHint, primary: true, disabled: false, run: () => s.setScanner("barcode") },
    { key: "receipt", icon: ReceiptText, art: <ReceiptArt />, tone: "receipt", title: t.phone.receipt, hint: t.phone.receiptHint, primary: true, disabled: ro.ro, run: () => (isPhone() ? s.setScanner("receipt") : s.openReceipt()) },
    { key: "paste", icon: Link2, art: <LinkArt />, tone: "link", title: t.phone.paste, hint: t.phone.pasteHint, primary: true, kbd: "/", disabled: ro.ro, run: () => (isPhone() ? s.setPasteOpen(true) : s.focusAdd()) },
    { key: "plan", icon: Sparkles, art: <PlanArt />, tone: "plan", title: t.phone.plan, hint: t.phone.planHint, primary: true, disabled: ro.ro || !s.aiEnabled, run: () => s.setPanel("planner") },
    { key: "import", icon: FileSpreadsheet, title: t.io.importTitle, short: t.phone.importShort, primary: false, disabled: ro.ro, run: () => s.setPanel("import") },
    { key: "list", icon: ListPlus, title: t.nav.newList, primary: false, disabled: ro.ro, run: () => s.setEditor({ mode: "create", kind: "list" }) },
    { key: "project", icon: FolderPlus, title: t.nav.newProject, primary: false, disabled: ro.ro, run: () => s.setEditor({ mode: "create", kind: "project" }) },
  ];
  return actions;
}
