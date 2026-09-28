"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, FolderPlus, Lightbulb, Loader2, MessageSquare, Sparkles, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { addPlannedParts, ask, planWithAi } from "@/app/ai-actions";
import { useI18n } from "@/components/providers";
import { Button, Textarea } from "@/components/ui/button";
import { Sheet, SheetClose } from "@/components/ui/overlays";
import type { Plan, PlannedPart } from "@/lib/assistant";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useStore } from "./store";

// ---------- tiny, safe markdown: paragraphs, "- " lists, **bold**, [[itemId]] chips ----------

function Inline({ text, onItem }: { text: string; onItem: (id: string) => void }) {
  const s = useStore();
  const parts = text.split(/(\*\*[^*]+\*\*|\[\[[\w-]{6,20}\]\])/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\*\*[^*]+\*\*$/.test(p)) return <b key={i} className="font-semibold text-fg">{p.slice(2, -2)}</b>;
        const m = p.match(/^\[\[([\w-]{6,20})\]\]$/);
        if (m) {
          const item = s.items.find((x) => x.id === m[1]);
          if (!item) return null;
          return (
            <button key={i} type="button" onClick={() => onItem(item.id)} className="mx-0.5 inline-flex max-w-[220px] translate-y-[2px] items-center truncate rounded-md border border-line bg-raised px-1.5 text-xs font-medium text-accent-ink hover:border-accent" title={item.title}>
              ↗ {item.title}
            </button>
          );
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

function Markdown({ text, onItem }: { text: string; onItem: (id: string) => void }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const isItem = /^\s*[-*•]\s+/.test(line);
    if (!line.trim()) {
      blocks.push({ list: false, lines: [] });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last && last.list === isItem && last.lines.length) last.lines.push(isItem ? line.replace(/^\s*[-*•]\s+/, "") : line);
    else blocks.push({ list: isItem, lines: [isItem ? line.replace(/^\s*[-*•]\s+/, "") : line] });
  }
  return (
    <div className="space-y-2 text-sm leading-relaxed text-muted" dir="auto">
      {blocks
        .filter((b) => b.lines.length)
        .map((b, i) =>
          b.list ? (
            <ul key={i} className="list-disc space-y-1 ps-5">
              {b.lines.map((l, j) => (
                <li key={j}>
                  <Inline text={l} onItem={onItem} />
                </li>
              ))}
            </ul>
          ) : (
            <p key={i}>
              {b.lines.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  <Inline text={l} onItem={onItem} />
                </Fragment>
              ))}
            </p>
          ),
        )}
    </div>
  );
}

// ---------- Ask ----------

type Msg = { role: "user" | "assistant"; text: string };

function AskTab({ seed, seedKey }: { seed: string | null; seedKey: string | null }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const seeded = useRef<string | null>(null);

  const send = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const history = msgs;
    setMsgs((m) => [...m, { role: "user", text }]);
    setQ("");
    setBusy(true);
    try {
      const r = await ask({ question: text, history, currency: s.currency, locale });
      setMsgs((m) => [...m, { role: "assistant", text: "text" in r ? r.text : r.error === "no_ai" ? t.ai.noAi : t.ai.failed }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", text: t.ai.failed }]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (seed && seedKey && seeded.current !== seedKey) {
      seeded.current = seedKey;
      const timer = setTimeout(() => void send(seed), 0);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [msgs, busy]);

  const openItem = (id: string) => {
    s.setPanel(null);
    s.openItem(id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!msgs.length && (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t.ai.askIntro}</p>
            <div className="flex flex-wrap gap-1.5">
              {[t.ai.ex1, t.ai.ex2, t.ai.ex3, t.ai.ex4].map((ex) => (
                <button key={ex} type="button" onClick={() => void send(ex)} className="rounded-full border border-line px-3 py-1.5 text-start text-[13px] text-muted transition hover:border-line-strong hover:text-fg">
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ms-10 rounded-2xl rounded-ee-md bg-sunken px-3.5 py-2.5 text-sm" dir="auto">
              {m.text}
            </div>
          ) : (
            <div key={i} className="flex gap-2.5">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">
                <Sparkles className="size-3.5" />
              </span>
              <Markdown text={m.text} onItem={openItem} />
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2.5 text-sm text-muted">
            <span className="grid size-6 place-items-center rounded-full bg-accent-soft text-accent-ink">
              <Sparkles className="size-3.5 animate-pulse" />
            </span>
            {t.ai.thinking}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(q);
        }}
        className="flex items-end gap-2 border-t border-line p-3"
      >
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(q);
            }
          }}
          rows={1}
          dir="auto"
          placeholder={t.ai.askPlaceholder}
          className="field-sizing-content max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-line-strong bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <Button type="submit" variant="accent" size="icon" className="size-10 rounded-xl" disabled={busy || !q.trim()} aria-label={t.ai.send}>
          {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </form>
    </div>
  );
}

// ---------- Plan ----------

function PlanTab() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const current = s.view.type === "collection" ? s.collections.find((c) => c.id === (s.view as { id: string }).id) : null;
  const [desc, setDesc] = useState("");
  const [budget, setBudget] = useState("");
  const [target, setTarget] = useState<string>(current?.id ?? "new");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const r = await planWithAi({
        description: desc,
        budget: budget.trim() ? Number(budget) : null,
        currency: s.currency,
        locale,
        collectionId: target === "new" ? null : target,
      });
      if ("error" in r) return toast.error(r.error === "no_ai" ? t.ai.noAi : t.ai.failed);
      setPlan(r);
      setPicked(new Set(r.parts.map((p, i) => (!p.have ? i : -1)).filter((i) => i >= 0)));
    } catch {
      toast.error(t.ai.failed);
    } finally {
      setBusy(false);
    }
  };

  const est = useMemo(() => {
    if (!plan) return { min: 0, max: 0 };
    let min = 0;
    let max = 0;
    plan.parts.forEach((p, i) => {
      if (!picked.has(i)) return;
      min += (p.estMin ?? p.estMax ?? 0) * p.qty;
      max += (p.estMax ?? p.estMin ?? 0) * p.qty;
    });
    return { min, max };
  }, [plan, picked]);

  const add = async () => {
    if (!plan) return;
    setAdding(true);
    try {
      const parts = plan.parts.filter((_, i) => picked.has(i)).map(({ have, ...p }) => (void have, p));
      const r = await addPlannedParts({
        parts,
        collectionId: target === "new" ? null : target,
        newProject: target === "new" ? { name: plan.projectName || t.ai.untitled, description: plan.summary, budget: budget.trim() ? Number(budget) : null } : null,
        currency: s.currency,
        estimateLabel: t.ai.estimate,
      });
      if (r.collection) s.upsertCollection(r.collection);
      s.upsertItems(r.items);
      const id = r.collection?.id ?? (target === "new" ? null : target);
      s.setPanel(null);
      if (id) s.setView({ type: "collection", id });
      toast.success(f(t.ai.added, { n: r.items.length }), { description: t.ai.addedHint });
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setAdding(false);
    }
  };

  if (plan) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold" dir="auto">
                {plan.projectName}
              </h3>
              <p className="mt-0.5 text-sm text-muted" dir="auto">
                {plan.summary}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setPlan(null)}>
              {t.io.back}
            </Button>
          </div>

          <ul className="mt-4 space-y-1.5">
            {plan.parts.map((p: PlannedPart, i) => {
              const on = picked.has(i);
              return (
                <li key={i}>
                  <label className={cn("flex cursor-pointer gap-3 rounded-xl border p-3 transition", on ? "border-accent/50 bg-accent-soft/30" : "border-line opacity-70 hover:opacity-100")}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setPicked((set) => {
                        const n = new Set(set);
                        if (n.has(i)) n.delete(i);
                        else n.add(i);
                        return n;
                      })}
                      className="mt-1 size-4 accent-[var(--accent)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="text-sm font-medium" dir="auto">
                          {p.name}
                          {p.qty > 1 && <span className="tabular ms-1.5 text-muted">×{p.qty}</span>}
                        </span>
                        {(p.estMin != null || p.estMax != null) && (
                          <span className="tabular text-xs text-muted">
                            ~{[p.estMin, p.estMax].filter((v) => v != null).map((v) => formatMoney(v, plan.currency, locale)).join("–")}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted" dir="auto">
                        {p.spec}
                      </p>
                      <div className="mt-1 flex gap-1.5">
                        {!p.essential && <span className="rounded bg-sunken px-1.5 text-[11px] text-muted">{t.ai.optional}</span>}
                        {p.have && <span className="rounded bg-ok-soft px-1.5 text-[11px] text-ok">{t.ai.have}</span>}
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>

          {plan.tips.length > 0 && (
            <div className="mt-4 rounded-xl border border-line bg-bg/50 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-faint">
                <Lightbulb className="size-3.5" />
                {t.ai.tips}
              </div>
              <ul className="list-disc space-y-1 ps-5 text-[13px] text-muted" dir="auto">
                {plan.tips.map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line p-3">
          <span className="tabular text-sm text-muted">
            {picked.size} · ~{formatMoney(est.min, plan.currency, locale)}
            {est.max > est.min ? `–${formatMoney(est.max, plan.currency, locale)}` : ""}
          </span>
          <Button variant="accent" onClick={add} disabled={adding || !picked.size}>
            {adding ? <Loader2 className="animate-spin" /> : <Check />}
            {target === "new" ? t.ai.createProject : f(t.ai.addTo, { n: picked.size })}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-4">
      <p className="text-sm text-muted">{t.ai.planIntro}</p>
      <Textarea rows={6} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t.ai.planPlaceholder} dir="auto" autoFocus />
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{t.ai.for}</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-10 w-full rounded-lg border border-line-strong bg-bg px-2 text-sm outline-none focus:border-accent">
            <option value="new">+ {t.nav.newProject}</option>
            {s.collections
              .filter((c) => !c.archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">
            {t.collection.budget} ({s.currency})
          </span>
          <input type="number" min={0} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={t.collection.noBudget} className="tabular h-10 w-full rounded-lg border border-line-strong bg-bg px-3 text-sm outline-none focus:border-accent" />
        </label>
      </div>
      <Button variant="accent" className="w-full" onClick={run} disabled={busy || desc.trim().length < 8}>
        {busy ? <Loader2 className="animate-spin" /> : <Wand2 />}
        {busy ? t.ai.planning : t.ai.plan}
      </Button>
      {busy && <p className="text-center text-xs text-faint">{t.ai.planningHint}</p>}
    </div>
  );
}

// ---------- Panel ----------

export function AssistantPanel() {
  const s = useStore();
  const seed = s.askSeed ? s.askSeed.split("\u200b")[0] : null;
  const seedKey = s.askSeed;
  const { t } = useI18n();
  const [tab, setTab] = useState<"ask" | "plan">("ask");
  const open = s.panel === "assistant" || s.panel === "planner";
  const active = s.panel === "planner" ? "plan" : tab;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && s.setPanel(null)} title={t.ai.title}>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="grid grid-cols-2 rounded-lg border border-line-strong bg-bg p-0.5 text-[13px]" role="tablist">
            {(["ask", "plan"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={active === k}
                type="button"
                onClick={() => {
                  setTab(k);
                  s.setPanel(k === "plan" ? "planner" : "assistant");
                }}
                className={cn("inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 transition [&_svg]:size-3.5", active === k ? "bg-fg text-bg" : "text-muted hover:text-fg")}
              >
                {k === "ask" ? <MessageSquare /> : <FolderPlus />}
                {k === "ask" ? t.ai.askTab : t.ai.planTab}
              </button>
            ))}
          </div>
          <SheetClose className="grid size-8 place-items-center rounded-md text-muted hover:bg-sunken hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </SheetClose>
        </div>
        {active === "ask" ? <AskTab seed={seed} seedKey={seedKey} /> : <PlanTab />}
      </div>
    </Sheet>
  );
}
