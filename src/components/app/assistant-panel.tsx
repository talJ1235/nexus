"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, FolderPlus, Lightbulb, MessageSquare, Square, SquarePen, Wand2, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { LogoMark } from "@/components/logo";
import { toast } from "@/lib/toast";
import { addPlannedParts, planWithAi } from "@/app/ai-actions";
import { useI18n } from "@/components/providers";
import { Button, Textarea } from "@/components/ui/button";
import { Sheet, SheetClose } from "@/components/ui/overlays";
import type { Plan, PlannedPart } from "@/lib/assistant";
import type { Proposal } from "@/lib/assistant-actions";
import { readRecent, recordRecent, suggestQuestions, type Suggestion } from "@/lib/assistant-suggestions";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { unitPrice } from "@/lib/calc";
import { ProductImage } from "./item-card";
import { ActionCard } from "./assistant-action-card";
import { useStore } from "./store";

// ---------- Suggestion chips (one scrollable row on phones, wrapping on desktop) ----------

function Chips({ list, onPick, label, testId }: { list: Suggestion[]; onPick: (text: string) => void; label: string; testId: string }) {
  if (!list.length) return null;
  return (
    <div role="group" aria-label={label} data-testid={testId} className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden">
      {list.map((sug) => (
        <button
          key={sug.text}
          type="button"
          onClick={() => onPick(sug.text)}
          className="inline-flex h-10 shrink-0 snap-start items-center whitespace-nowrap rounded-full border border-line px-3.5 text-start text-[13px] text-muted transition hover:border-line-strong hover:text-fg active:bg-sunken md:h-auto md:min-h-8 md:shrink md:whitespace-normal md:py-1.5"
        >
          <span>
            {sug.parts.map((p, i) =>
              p.name ? (
                <span key={i} className="bidi font-medium text-fg">
                  {p.text}
                </span>
              ) : (
                <Fragment key={i}>{p.text}</Fragment>
              ),
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------- Ask (streamed; Round 7 F1/F2) ----------

type Msg = { role: "user" | "assistant"; text: string; proposal?: Proposal | null; streaming?: boolean; error?: boolean };
export type ModelState = "idle" | "ok" | "busy";

/** The Box mark, faces breathing in sequence while Nexus works. */
function BoxThinking({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("box-think size-7 shrink-0", className)} aria-hidden>
      <path d="M10 20l22 12v24L10 44z" fill="var(--logo-c1)" />
      <path d="M54 20 32 32v24l22-12z" fill="var(--logo-c2)" />
      <path d="M32 8 54 20 32 32 10 20z" fill="var(--logo-c3)" />
    </svg>
  );
}

function Waiting() {
  const { t } = useI18n();
  const lines = [t.ai.status1, t.ai.status2, t.ai.status3, t.ai.status4];
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => Math.min(n + 1, lines.length - 1)), 1500);
    return () => clearInterval(id);
  }, [lines.length]);
  return (
    <div className="flex animate-pop-in items-center gap-3" role="status" aria-label={t.ai.thinking} data-ai-waiting>
      <BoxThinking />
      <span key={i} className="shimmer-text animate-pop-in text-[13.5px] font-semibold">
        {lines[i]}
      </span>
    </div>
  );
}

const MONEY = /([₪$€]\s?\d[\d,.]*|\d[\d,.]*\s?[₪$€])/;

/** Words fade in as they arrive (keys by position, so words already shown never re-animate). */
function Words({ text, base }: { text: string; base: string }) {
  return (
    <>
      {text.split(/(\s+)/).map((w, i) => (w.trim() ? <span key={`${base}${i}`} className="word-in">{w}</span> : <Fragment key={`${base}${i}`}>{w}</Fragment>))}
    </>
  );
}

function Inline({ text, onItem, base }: { text: string; onItem: (id: string) => void; base: string }) {
  const s = useStore();
  const parts = text.split(/(\*\*[^*]+\*\*|\[\[[\w-]{6,24}\]\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const k = `${base}.${i}`;
        if (/^\*\*[^*]+\*\*$/.test(p)) {
          const inner = p.slice(2, -2);
          return /\d/.test(inner) ? (
            <span key={k} className="word-in mx-0.5 inline-block rounded-md bg-surface-2 px-1.5 font-bold tabular-nums text-ink">{inner}</span>
          ) : (
            <b key={k} className="font-bold text-ink"><Words text={inner} base={k} /></b>
          );
        }
        const m = p.match(/^\[\[([\w-]{6,24})\]\]$/);
        if (m) {
          const item = s.items.find((x) => x.id === m[1]);
          return item ? (
            <button key={k} type="button" onClick={() => onItem(item.id)} className="word-in font-semibold text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink" title={item.title}>
              ↗
            </button>
          ) : null;
        }
        // Plain money amounts become chips too.
        return p.split(MONEY).map((q, j) =>
          MONEY.test(q) && /^[₪$€\d]/.test(q.trim()) ? (
            <span key={`${k}.${j}`} className="word-in mx-0.5 inline-block rounded-md bg-surface-2 px-1.5 font-semibold tabular-nums text-ink">{q.trim()}</span>
          ) : (
            <Words key={`${k}.${j}`} text={q} base={`${k}.${j}.`} />
          ),
        );
      })}
    </>
  );
}

/** Assistant answer: no bubble — a bold lead line, then clean paragraphs/lists; referenced items as mini cards. */
function Answer({ text, streaming, onItem }: { text: string; streaming?: boolean; onItem: (id: string) => void }) {
  const s = useStore();
  const { locale } = useI18n();
  // While streaming, hide a half-written action block (it is parsed once the answer is complete).
  const shown = streaming ? text.split("```")[0] : text;
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of shown.split("\n")) {
    const line = raw.trimEnd();
    const isItem = /^\s*[-*•]\s+/.test(line);
    if (!line.trim()) {
      blocks.push({ list: false, lines: [] });
      continue;
    }
    const last = blocks[blocks.length - 1];
    const body = isItem ? line.replace(/^\s*[-*•]\s+/, "") : line;
    if (last && last.list === isItem && last.lines.length) last.lines.push(body);
    else blocks.push({ list: isItem, lines: [body] });
  }
  const filled = blocks.filter((b) => b.lines.length);
  const ids = [...new Set([...text.matchAll(/\[\[([\w-]{6,24})\]\]/g)].map((m) => m[1]))];
  const refs = ids.map((id) => s.items.find((i) => i.id === id)).filter(Boolean) as typeof s.items;
  return (
    <div className="space-y-2.5 text-[14px] leading-relaxed text-ink/85" dir="auto" data-ai-answer>
      {filled.map((b, i) => {
        if (b.list)
          return (
            <ul key={i} className="space-y-1.5">
              {b.lines.map((l, j) => (
                <li key={j} className="flex gap-2">
                  <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-muted" aria-hidden />
                  <span className="min-w-0">
                    <Inline text={l} onItem={onItem} base={`${i}.${j}`} />
                  </span>
                </li>
              ))}
            </ul>
          );
        const [lead, ...rest] = i === 0 ? splitLead(b.lines) : [null, ...b.lines];
        return (
          <p key={i}>
            {lead != null && (
              <span className="mb-1 block text-[15.5px] font-bold leading-snug text-ink" data-ai-lead>
                <Inline text={lead} onItem={onItem} base={`${i}.l`} />
              </span>
            )}
            {rest.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Inline text={l} onItem={onItem} base={`${i}.${j}`} />
              </Fragment>
            ))}
          </p>
        );
      })}
      {streaming && <span className="caret" aria-hidden />}
      {!streaming && refs.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pt-1 [scrollbar-width:none]" data-ai-refs>
          {refs.map((it, k) => {
            const unit = unitPrice(it, s.rates, s.currency);
            return (
              <button key={it.id} type="button" onClick={() => onItem(it.id)} className="rise-in flex w-40 shrink-0 flex-col gap-1.5 rounded-[18px] border border-line bg-surface p-1.5 text-start transition hover:-translate-y-0.5" style={{ animationDelay: `${k * 50}ms` }}>
                <ProductImage src={it.imageUrl} alt="" className="aspect-[16/11] w-full rounded-[13px]" iconClass="size-5" />
                <span className="line-clamp-2 px-1 text-[12.5px] font-bold leading-snug text-ink bidi">{it.title}</span>
                <span className="tabular px-1 pb-0.5 text-[13px] font-extrabold text-ink">{unit != null ? formatMoney(unit, s.currency, locale) : "—"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** First paragraph: its first sentence is the lead line. */
function splitLead(lines: string[]): [string | null, ...string[]] {
  const first = lines[0];
  const m = first.match(/^(.+?[.!?:])(\s+)(.+)$/);
  if (m && m[1].length >= 12) return [m[1], m[3], ...lines.slice(1)];
  return [first, ...lines.slice(1)];
}

function AskTab({ seed, seedKey, onModel }: { seed: string | null; seedKey: string | null; onModel: (m: ModelState) => void }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const seeded = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [recent, setRecent] = useState<string[]>(() => (typeof window === "undefined" ? [] : readRecent()));
  const [now] = useState(() => Date.now());

  const base = { items: s.items, collections: s.collections, altGroups: s.altGroups, view: s.view, now, rates: s.rates, currency: s.currency, t: t.ai.sug };
  const suggestions = useMemo(
    () => suggestQuestions({ ...base, recent, fallback: [t.ai.ex1, t.ai.ex2, t.ai.ex3, t.ai.ex4] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.items, s.collections, s.altGroups, s.view, s.rates, s.currency, t, recent, now],
  );
  const lastIsAnswer = !busy && msgs.length > 0 && msgs[msgs.length - 1].role === "assistant" && !msgs[msgs.length - 1].error;
  const followUps = useMemo(
    () => (lastIsAnswer ? suggestQuestions({ ...base, recent: [...msgs.filter((m) => m.role === "user").map((m) => m.text), ...recent], fallback: [t.ai.ex1, t.ai.ex2, t.ai.ex3, t.ai.ex4], limit: 3 }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lastIsAnswer, msgs, s.items, s.collections, s.altGroups, s.view, s.rates, s.currency, t, recent, now],
  );

  const patchLast = (fn: (m: Msg) => Msg) => setMsgs((list) => (list.length ? [...list.slice(0, -1), fn(list[list.length - 1])] : list));

  const send = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setRecent(recordRecent(text));
    const history = msgs.filter((m) => !m.error).map(({ role, text }) => ({ role, text }));
    setMsgs((m) => [...m, { role: "user", text }]);
    setQ("");
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    let started = false;
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: text, history, currency: s.currency, locale }), signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as { t: "route"; fallback: boolean } | { t: "delta"; text: string } | { t: "done"; text: string; proposal: Proposal | null } | { t: "error"; error: string };
          if (ev.t === "route") onModel(ev.fallback ? "busy" : "ok");
          else if (ev.t === "delta") {
            if (!started) {
              started = true;
              setMsgs((m) => [...m, { role: "assistant", text: ev.text, streaming: true }]);
            } else patchLast((m) => ({ ...m, text: m.text + ev.text }));
          } else if (ev.t === "done") {
            if (!started) setMsgs((m) => [...m, { role: "assistant", text: ev.text, proposal: ev.proposal }]);
            else patchLast((m) => ({ ...m, text: ev.text, proposal: ev.proposal, streaming: false }));
            started = true;
          } else if (ev.t === "error") {
            const msg = ev.error === "no_ai" ? t.ai.noAi : t.ai.failed;
            if (started) patchLast((m) => ({ ...m, streaming: false }));
            else setMsgs((m) => [...m, { role: "assistant", text: msg, error: true }]);
            started = true;
          }
        }
      }
      if (started) patchLast((m) => ({ ...m, streaming: false }));
    } catch {
      // Stopped by the user (keeps what arrived) or a network error.
      if (started) patchLast((m) => ({ ...m, streaming: false }));
      else if (!ctrl.signal.aborted) setMsgs((m) => [...m, { role: "assistant", text: t.ai.failed, error: true }]);
    } finally {
      abort.current = null;
      setBusy(false);
    }
  };

  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    if (seed && seedKey && seeded.current !== seedKey) {
      seeded.current = seedKey;
      const timer = setTimeout(() => void send(seed), 0);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and an effect must not return it.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  const openItem = (id: string) => {
    s.setPanel(null);
    s.openItem(id);
  };
  const waiting = busy && msgs[msgs.length - 1]?.role === "user";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {!msgs.length && (
          <div className="flex flex-col items-start gap-3 pt-6">
            <BoxThinking className="size-10 [&_path]:animate-none" />
            <p className="text-[15px] font-semibold text-ink">{t.ai.askIntro}</p>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-[20px] rounded-ee-[6px] bg-[color-mix(in_srgb,var(--ink)_8%,var(--surface))] px-3.5 py-2 text-[14px] text-ink" dir="auto" data-ai-user>
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-3">
              {m.error ? <p className="text-sm text-muted">{m.text}</p> : <Answer text={m.text} streaming={m.streaming} onItem={openItem} />}
              {m.proposal && <ActionCard proposal={m.proposal} onItem={openItem} />}
            </div>
          ),
        )}
        {waiting && <Waiting />}
        {followUps.length > 0 && (
          <div className="rise-in">
            <Chips list={followUps} onPick={(q) => void send(q)} label={t.ai.followUps} testId="ai-followups" />
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="flex flex-col gap-2 border-t border-line px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        {!msgs.length && <Chips list={suggestions} onPick={(q) => void send(q)} label={t.ai.suggestions} testId="ai-suggestions" />}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) abort.current?.abort();
            else void send(q);
          }}
          className="flex items-end gap-2 rounded-[26px] border border-line bg-surface-2 p-1.5 ps-4 focus-within:border-ink/30"
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
            className="field-sizing-content max-h-32 min-h-10 flex-1 resize-none bg-transparent py-2.5 text-[14px] outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={!busy && !q.trim()}
            aria-label={busy ? t.ai.stop : t.ai.send}
            data-ai-send={busy ? "stop" : "send"}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-on-brand transition-[transform,opacity] duration-200 active:scale-90 disabled:opacity-40"
          >
            <span key={busy ? "stop" : "send"} className="animate-pop-in">
              {busy ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-[18px]" />}
            </span>
          </button>
        </form>
      </div>
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
              <h3 className="font-semibold bidi">
                {plan.projectName}
              </h3>
              <p className="mt-0.5 text-sm text-muted bidi">
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
                        <span className="text-sm font-medium bidi">
                          {p.name}
                          {p.qty > 1 && <span className="tabular ms-1.5 text-muted">×{p.qty}</span>}
                        </span>
                        {(p.estMin != null || p.estMax != null) && (
                          <span className="tabular text-xs text-muted">
                            ~{[p.estMin, p.estMax].filter((v) => v != null).map((v) => formatMoney(v, plan.currency, locale)).join("–")}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted bidi">
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
              <ul className="list-disc space-y-1 ps-5 text-[13px] text-muted bidi">
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
            {adding ? <Spinner /> : <Check />}
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
        {busy ? <Spinner /> : <Wand2 />}
        {busy ? t.ai.planning : t.ai.plan}
      </Button>
      {busy && <p className="text-center text-xs text-faint">{t.ai.planningHint}</p>}
    </div>
  );
}

// ---------- Panel ----------

/**
 * Desktop: a 420 px side panel that slides in with a spring. Phone: a full-screen sheet with a drag handle —
 * swipe down to close. Header: Box + "Nexus" + model status dot, new chat, close.
 */
export function AssistantPanel() {
  const s = useStore();
  const seed = s.askSeed ? s.askSeed.split("\u200b")[0] : null;
  const seedKey = s.askSeed;
  const { t } = useI18n();
  const [tab, setTab] = useState<"ask" | "plan">("ask");
  const [chat, setChat] = useState(0);
  const [model, setModel] = useState<ModelState>("idle");
  const open = s.panel === "assistant" || s.panel === "planner";
  const active = s.panel === "planner" ? "plan" : tab;
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);

  // Swipe the handle down to close (phone).
  const sheetEl = () => wrap.current?.closest<HTMLElement>("[role=dialog]") ?? null;
  const onDown = (e: React.PointerEvent) => {
    if (!window.matchMedia("(max-width: 639px)").matches || (e.target as HTMLElement).closest("button")) return;
    drag.current = { y: e.clientY, dy: 0 };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    const el = sheetEl();
    if (el) {
      el.style.transition = "none";
      el.style.transform = `translateY(${drag.current.dy}px)`;
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    const el = sheetEl();
    if (!el || !d) return;
    el.style.transition = "transform 320ms var(--ease-out)";
    if (d.dy > 110) {
      el.style.transform = "translateY(100%)";
      setTimeout(() => s.setPanel(null), 200);
    } else el.style.transform = "";
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && s.setPanel(null)} title={t.ai.title} className="assistant-sheet sm:max-w-[420px]">
      <div ref={wrap} className="flex h-full flex-col" data-assistant>
        <div className="flex justify-center pt-2 sm:hidden" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ touchAction: "none" }} data-ai-handle>
          <span className="h-1.5 w-10 rounded-full bg-line-strong" />
        </div>
        <div className="flex items-center gap-2 px-4 pb-2 pt-2 sm:pt-4" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <LogoMark className="size-7" />
          <span className="text-[17px] font-extrabold tracking-[-0.02em]">Nexus</span>
          <span
            className={cn("size-2 rounded-full", model === "busy" ? "bg-spark" : model === "ok" ? "bg-ok" : "bg-line-strong")}
            title={model === "busy" ? t.ai.modelBusy : model === "ok" ? t.ai.modelOk : undefined}
            aria-label={model === "busy" ? t.ai.modelBusy : model === "ok" ? t.ai.modelOk : undefined}
            data-ai-model={model}
          />
          <span className="flex-1" />
          {active === "ask" && (
            <button type="button" onClick={() => setChat((n) => n + 1)} className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label={t.ai.newChat} title={t.ai.newChat} data-ai-new>
              <SquarePen className="size-[18px]" />
            </button>
          )}
          <SheetClose className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <X className="size-[18px]" />
          </SheetClose>
        </div>
        <div className="px-4 pb-2">
          <div className="grid grid-cols-2 rounded-full bg-surface-2 p-[3px] text-[13px]" role="tablist">
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
                className={cn("inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 font-semibold transition [&_svg]:size-3.5", active === k ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink")}
              >
                {k === "ask" ? <MessageSquare /> : <FolderPlus />}
                {k === "ask" ? t.ai.askTab : t.ai.planTab}
              </button>
            ))}
          </div>
        </div>
        {active === "ask" ? <AskTab key={chat} seed={seed} seedKey={seedKey} onModel={setModel} /> : <PlanTab />}
      </div>
    </Sheet>
  );
}
