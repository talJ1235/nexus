"use client";

import { useEffect, useState } from "react";
import { Check, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { deleteMemoryNote, getMemoryState, saveMemoryNote, setMemoryEnabled, updateMemoryNote, type MemoryNote, type MemoryState } from "@/app/memory-actions";
import { useI18n } from "@/components/providers";
import { Button, Input } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatMoney } from "@/lib/money";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStore } from "./store";

/** Settings → "What Nexus knows about you" (Round 9 C3): the switch, the computed profile (read-only), the notes. */
export function MemorySection() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const [st, setSt] = useState<MemoryState | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const m = (v: number) => formatMoney(Math.round(v), s.currency, locale);

  const load = async (refresh = false) => {
    setBusy(true);
    try {
      setSt(await getMemoryState(s.currency, refresh));
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the state from the server when shown
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.currency]);

  const toggle = async () => {
    if (!st) return;
    const on = !st.enabled;
    setSt({ ...st, enabled: on });
    await setMemoryEnabled(on).catch(() => setSt({ ...st }));
  };
  const add = async () => {
    const text = draft.trim();
    if (!text || !st) return;
    const r = await saveMemoryNote(text, "manual").catch(() => null);
    if (!r) return toast.error(t.errors.generic);
    if ("error" in r) return toast.error(t.memory.sensitive);
    setSt({ ...st, notes: [...st.notes, r] });
    setDraft("");
  };
  const save = async () => {
    if (!editing || !st) return;
    const r = await updateMemoryNote(editing.id, editing.text).catch(() => null);
    if (!r) return toast.error(t.errors.generic);
    if ("error" in r) return toast.error(t.memory.sensitive);
    setSt({ ...st, notes: st.notes.map((n) => (n.id === r.id ? r : n)) });
    setEditing(null);
  };
  const remove = async (n: MemoryNote) => {
    if (!st) return;
    setSt({ ...st, notes: st.notes.filter((x) => x.id !== n.id) });
    await deleteMemoryNote(n.id).catch(() => toast.error(t.errors.generic));
  };

  const p = st?.profile;
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-3 py-1.5 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 bidi">{value}</span>
    </div>
  );

  return (
    <section className="space-y-3 border-t border-line pt-5" data-memory>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold">{t.memory.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t.memory.hint}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!st?.enabled}
          aria-label={t.memory.switch}
          disabled={!st}
          onClick={() => void toggle()}
          className={cn("relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition", st?.enabled ? "bg-brand" : "bg-line-strong")}
          data-memory-switch
        >
          <span className={cn("absolute top-0.5 size-6 rounded-full bg-surface shadow transition-[inset-inline-start]", st?.enabled ? "start-[22px]" : "start-0.5")} />
        </button>
      </div>
      {!st ? (
        <div className="grid place-items-center py-6">
          <Spinner />
        </div>
      ) : !st.enabled ? (
        <p className="rounded-[14px] bg-surface-2 px-3.5 py-3 text-[13px] text-muted">{t.memory.off}</p>
      ) : (
        <>
          <div className="rounded-[16px] border border-line px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-2 pb-1">
              <span className="text-[12.5px] font-semibold text-muted">{t.memory.profile}</span>
              <button type="button" onClick={() => void load(true)} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold text-muted hover:bg-surface-2 hover:text-ink">
                <RefreshCw className={cn("size-3.5", busy && "animate-[spin_1s_linear_infinite]")} /> {t.memory.refresh}
              </button>
            </div>
            {!p || !p.basis ? (
              <p className="py-2 text-[13px] text-muted">{t.memory.nothingYet}</p>
            ) : (
              <div className="divide-y divide-line" data-memory-profile>
                {p.stores.length > 0 && row(t.memory.stores, p.stores.map((x) => `${x.store} (${x.count})`).join(", "))}
                {p.categories.length > 0 && row(t.memory.categories, p.categories.map((c) => `${t.categories[c.category as keyof typeof t.categories] ?? c.category} ${Math.round(c.share * 100)}%`).join(", "))}
                {p.prices.length > 0 &&
                  row(
                    t.memory.prices,
                    p.prices.slice(0, 4).map((c) => `${t.categories[c.category as keyof typeof t.categories] ?? c.category}: ${m(c.p25)}–${m(c.p75)}`).join(" · "),
                  )}
                {p.brands.length > 0 && row(t.memory.brands, p.brands.map((b) => b.brand).join(", "))}
                {p.orders.count > 0 &&
                  row(t.memory.orders, f(t.memory.ordersLine, { n: p.orders.count, items: Math.round(p.orders.itemsPerOrder * 10) / 10, spend: m(p.orders.spendPerOrder), free: Math.round(p.orders.freeShippingShare * 100) }))}
                {p.projects.top.length > 0 && row(t.memory.projects, p.projects.top.join(", "))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <span className="text-[12.5px] font-semibold text-muted">{t.memory.notes}</span>
            {st.notes.length === 0 && <p className="text-[13px] text-muted">{t.memory.notesEmpty}</p>}
            <ul className="space-y-1.5">
              {st.notes.map((n) => (
                <li key={n.id} className="flex items-center gap-1.5 rounded-[14px] bg-surface-2 py-1 pe-1 ps-3.5" data-memory-note>
                  {editing?.id === n.id ? (
                    <>
                      <Input autoFocus value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void save()} maxLength={200} className="h-9 min-w-0 flex-1" dir="auto" />
                      <button type="button" onClick={() => void save()} className="grid size-9 place-items-center rounded-full text-ink" aria-label={t.memory.edit}>
                        <Check className="size-4" />
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className="grid size-9 place-items-center rounded-full text-muted" aria-label={t.report.cancel}>
                        <X className="size-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 py-1.5 text-[13.5px] bidi">{n.text}</span>
                      <button type="button" onClick={() => setEditing({ id: n.id, text: n.text })} className="grid size-9 place-items-center rounded-full text-muted hover:text-ink" aria-label={t.memory.edit}>
                        <Pencil className="size-4" />
                      </button>
                      <button type="button" onClick={() => void remove(n)} className="grid size-9 place-items-center rounded-full text-muted hover:text-danger" aria-label={t.memory.delete}>
                        <Trash2 className="size-4" />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
              className="flex gap-2"
            >
              <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t.memory.placeholder} aria-label={t.memory.add} maxLength={200} className="min-w-0 flex-1" dir="auto" data-memory-add />
              <Button type="submit" variant="outline" disabled={!draft.trim()}>
                <Plus /> <span className="max-sm:sr-only">{t.memory.add}</span>
              </Button>
            </form>
          </div>
        </>
      )}
    </section>
  );
}
