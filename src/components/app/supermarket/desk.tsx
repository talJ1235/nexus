"use client";

import "./sm.css";
import { useEffect, useState } from "react";
import { Check, ChevronRight, Plus, Smartphone } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Pop, PopContent, PopTrigger } from "@/components/ui/overlays";
import { applySupermarketTemplate, sendSmToPhone, smSendTargets, supermarketPastTrips, supermarketTemplates } from "@/app/supermarket-actions";
import { formatMoney } from "@/lib/money";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { sectionColor } from "./art";
import { asItem, storeLabel } from "./numbers";
import { useTemplateText, type Template } from "./lists";

// R18 S2 F3 — the computer's Supermarket page (board Supermarket-desktop): "Send to phone" (recipients: me + the members
// with push on by default → a push that opens the list) and the side panel's Templates (Add = merge) and Past trips.

type Target = Awaited<ReturnType<typeof smSendTargets>>[number];
const COLORS = ["#3b7fc4", "#7c5ad9", "#21938f", "#d17a22", "#c94673", "#3f9d5a"];

export function SendToPhone({ store }: { store: { chain: string; branch: string } | null }) {
  const s = useStore();
  const { t, f } = useI18n();
  const L = t.sm.desk;
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const viewer = s.space?.role === "viewer";
  useEffect(() => {
    if (!open) return;
    void smSendTargets().then(
      (ts) => {
        // A viewer reaches only their own phone.
        const list = viewer ? ts.filter((x) => x.me) : ts;
        setTargets(list);
        setPicked(new Set(list.filter((x) => x.me || x.push).map((x) => x.userId)));
      },
      () => setTargets([]),
    );
  }, [open, viewer]);
  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])));
  const send = async () => {
    setBusy(true);
    try {
      const r = await sendSmToPhone([...picked], store);
      toast.success(r.sent === 1 ? L.sentOne : f(L.sent, { n: r.sent }));
      setOpen(false);
    } catch {
      toast.error(L.failed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Pop open={open} onOpenChange={setOpen}>
      <PopTrigger asChild>
        <button type="button" className="inline-flex h-10 items-center gap-2 rounded-[12px] border border-line-strong bg-surface px-3.5 text-[14.5px] font-bold shadow-card transition-transform duration-150 ease-[var(--ease-out)] active:scale-95" data-sm-send>
          <Smartphone className="size-4" />
          {L.send}
        </button>
      </PopTrigger>
      <PopContent align="end" className="w-[340px] p-3.5">
        <div data-sm-send-pop>
          <b className="block text-[15.5px] font-extrabold">{L.sendTitle}</b>
          <span className="block text-[13px] text-muted">{L.sendSub}</span>
          <div className="mt-2.5 flex flex-col">
            {(targets ?? []).map((x, k) => {
              const on = picked.has(x.userId);
              return (
                <button key={x.userId} type="button" role="checkbox" aria-checked={on} className="flex min-h-[52px] items-center gap-3 rounded-[10px] px-1 text-start hover:bg-surface-2" onClick={() => toggle(x.userId)} data-sm-send-target={x.me ? "me" : x.userId}>
                  <span className={cn("grid size-6 shrink-0 place-items-center rounded-[7px] border-[1.5px]", on ? "border-ink bg-ink text-bg" : "border-line-strong")}>{on && <Check className="size-4" strokeWidth={3} />}</span>
                  <span className="grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white" style={{ background: COLORS[k % COLORS.length] }} aria-hidden>
                    {(x.name || "·").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="bidi block truncate text-[14.5px]">{x.me ? L.me : x.name}</b>
                    <span className="block truncate text-[12.5px] text-muted">{x.push ? L.pushOn : x.me ? L.noPhone : L.pushOff}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <button type="button" disabled={busy || !picked.size} className="mt-2.5 h-11 w-full rounded-[12px] bg-ink text-[15px] font-extrabold text-bg disabled:opacity-50" onClick={() => void send()} data-sm-send-go>
            {picked.size === 1 ? L.sendOne : f(L.sendN, { n: picked.size })}
          </button>
        </div>
      </PopContent>
    </Pop>
  );
}

const panel = "rounded-[18px] border border-line-strong bg-surface p-3.5 shadow-card";

/** Templates in the side panel: Add = merge into the list (never a duplicate, the user's quantities stay). */
export function DeskTemplates({ ro, onOpen, onSave }: { ro: boolean; onOpen: () => void; onSave: () => void }) {
  const s = useStore();
  const { t, f } = useI18n();
  const L = t.sm.desk;
  const tx = useTemplateText();
  const [list, setList] = useState<Template[] | null>(null);
  useEffect(() => {
    void supermarketTemplates().then(setList, () => setList([]));
  }, [s.spaceId]);
  if (!list) return null;
  const add = async (x: Template) => {
    try {
      const r = await applySupermarketTemplate(x.id);
      s.upsertSm(r.rows.map(asItem));
      toast.success(f(t.sm.lists.added, { n: r.added }));
    } catch {
      toast.error(t.sm.lists.failed);
    }
  };
  return (
    <section className={panel} data-sm-desk-templates>
      <div className="flex items-baseline justify-between gap-2 pb-1.5">
        <button type="button" className="text-[15.5px] font-extrabold hover:underline" onClick={onOpen}>
          {L.templates}
        </button>
        <span className="text-[12.5px] text-muted">{L.merge}</span>
      </div>
      {list.slice(0, 4).map((x) => (
        <div key={x.id} className="flex min-h-[52px] items-center gap-3" data-sm-desk-template={x.id}>
          <span className="min-w-0 flex-1">
            <b className="bidi block truncate text-[14.5px]">{tx.name(x)}</b>
            <span className="gro-rail mt-1.5 w-32" aria-hidden>
              {[...new Set(x.items.map((i) => i.section ?? "other"))].slice(0, 5).map((k) => (
                <i key={k} style={{ "--k": sectionColor(k), "--n": x.items.filter((i) => (i.section ?? "other") === k).length } as React.CSSProperties} />
              ))}
            </span>
          </span>
          <span className="tabular text-[13px] text-muted">{x.items.length}</span>
          {!ro && (
            <button type="button" className="h-9 rounded-[10px] border border-line-strong px-3 text-[13.5px] font-bold transition-transform duration-150 ease-[var(--ease-out)] active:scale-95" aria-label={f(L.addTpl, { name: tx.name(x) })} onClick={() => void add(x)} data-sm-desk-template-add>
              {L.add}
            </button>
          )}
        </div>
      ))}
      {!ro && s.sm.length > 0 && (
        <button type="button" className="mt-1 flex h-9 items-center gap-1.5 text-[13.5px] font-bold text-ink2" onClick={onSave} data-sm-desk-save>
          <Plus className="size-4" />
          {L.saveList}
        </button>
      )}
    </section>
  );
}

/** The last trips (date, store, total) → Insights → History → Supermarket (R18 S3 B2). */
export function DeskPast({ onOpen }: { onOpen: () => void }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const L = t.sm.desk;
  const [trips, setTrips] = useState<Awaited<ReturnType<typeof supermarketPastTrips>> | null>(null);
  useEffect(() => {
    void supermarketPastTrips().then(setTrips, () => setTrips([]));
  }, [s.spaceId]);
  if (!trips?.length) return null;
  const loc = locale === "he" ? "he-IL" : "en-US";
  return (
    <section className={panel} data-sm-desk-past>
      <div className="flex items-baseline justify-between pb-1.5">
        <b className="text-[15.5px] font-extrabold">{L.past}</b>
        <button type="button" className="inline-flex items-center gap-0.5 text-[13px] font-bold text-muted hover:text-ink" onClick={onOpen} data-sm-desk-past-all>
          {L.all}
          <ChevronRight className="size-3.5 rtl:-scale-x-100" />
        </button>
      </div>
      {trips.slice(0, 3).map((x) => (
        <button key={x.id} type="button" className="flex min-h-11 w-full items-center gap-3 text-start" onClick={onOpen}>
          <span className="tabular w-14 shrink-0 text-[13px] text-muted">{new Intl.DateTimeFormat(loc, { day: "numeric", month: "short" }).format(x.startedAt)}</span>
          <span className="bidi min-w-0 flex-1 truncate text-[14px] font-semibold">{storeLabel(x.chain ?? "", x.branch ?? "", locale) ?? x.chain}</span>
          <span className="tabular text-[14px] font-bold">{formatMoney(Math.round(x.total ?? x.items.reduce((a, i) => a + (i.price ?? 0), 0)), x.currency, locale)}</span>
        </button>
      ))}
    </section>
  );
}
