"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, Brain, Bug, ChartColumn, Check, ChevronRight, CircleHelp, History, MessageSquare, MessageSquareWarning, Send, Square, SquarePen, Wand2, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { LogoMark } from "@/components/logo";
import { toast } from "@/lib/toast";
import { planWithAi } from "@/app/ai-actions";
import { getConversation, latestConversation, listConversations, saveExchange, titleConversation, type MessageView } from "@/app/chat-actions";
import { computeProfile } from "@/lib/profile";
import { HistoryList } from "./assistant-history";
import { saveMemoryNote } from "@/app/memory-actions";
import { PlanCard } from "./assistant-plan-card";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose } from "@/components/ui/overlays";
import { PHONE, useMedia } from "@/components/ui/use-media";
import type { Plan } from "@/lib/assistant";
import type { Proposal } from "@/lib/assistant-actions";
import { readRecent, recordRecent, suggestQuestions, type Suggestion } from "@/lib/assistant-suggestions";
import { collectDiag, getLastExchange, setLastExchange } from "@/lib/client-diag";
import type { ReportFields } from "@/lib/reports";
import { createReport } from "@/app/report-actions";
import { extractActions, type NexusAction } from "@/lib/help/links";
import { applyPalette } from "@/lib/palette";
import type { View } from "@/lib/views";
import { useTheme } from "next-themes";
import { extensionVersion } from "./use-extension";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { unitPrice } from "@/lib/calc";
import { ProductImage } from "./item-card";
import { ActionCard } from "./assistant-action-card";
import { useStore } from "./store";

// ---------- Suggested questions (Round 8 D1: a vertical list, never a sideways scroll; Round 12 #3: rows) ----------

const CHIPS_SHOWN = 4;
/** What kind of question a suggestion is: a question about the data, a plan request, or how-to help. */
const sugKind = (family: string) => (family === "plan" ? "plan" : family === "help" ? "help" : "data");
const KIND_ICON = { data: ChartColumn, plan: Wand2, help: CircleHelp } as const;

/**
 * A list of full-width rows under a small label: type icon, the question (max 2 lines), a subtle chevron; hairline
 * separators, hover/press state. Follow-ups after an answer use the same rows, `compact`.
 */
function Chips({ list, onPick, label, heading, testId, compact }: { list: Suggestion[]; onPick: (text: string) => void; label: string; heading: string; testId: string; compact?: boolean }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, CHIPS_SHOWN);
  return (
    <div role="group" aria-label={label} data-testid={testId} className="flex min-w-0 flex-col items-stretch gap-1.5">
      <span className="px-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-faint" aria-hidden data-ai-sug-label>
        {heading}
      </span>
      <div className="overflow-hidden rounded-[16px] border border-line bg-surface">
        {shown.map((sug, i) => {
          const kind = sugKind(sug.family);
          const Icon = KIND_ICON[kind];
          return (
            <button
              key={sug.text}
              type="button"
              onClick={() => onPick(sug.text)}
              title={sug.text}
              className={cn(
                "group flex w-full items-center gap-3 px-3 text-start leading-snug text-fg transition-colors hover:bg-surface-2 active:bg-sunken",
                i > 0 && "border-t border-line",
                compact ? "min-h-10 py-1.5 text-[13px]" : "min-h-12 py-2 text-[13.5px]",
              )}
              data-ai-chip={kind}
            >
              <span className={cn("grid shrink-0 place-items-center rounded-[9px] bg-surface-2 text-muted transition-colors group-hover:text-fg", compact ? "size-6 [&_svg]:size-3.5" : "size-7 [&_svg]:size-4")} aria-hidden>
                <Icon />
              </span>
              <span className="line-clamp-2 min-w-0 flex-1 break-words">
                {sug.parts.map((p, j) =>
                  p.name ? (
                    <span key={j} className="bidi font-semibold">
                      {p.text}
                    </span>
                  ) : (
                    <Fragment key={j}>{p.text}</Fragment>
                  ),
                )}
              </span>
              <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
            </button>
          );
        })}
      </div>
      {list.length > CHIPS_SHOWN && !all && (
        <button type="button" onClick={() => setAll(true)} className="h-10 self-start rounded-full px-2 text-[13px] font-semibold text-muted transition hover:text-fg" data-ai-more>
          {t.ai.moreSuggestions}
        </button>
      )}
    </div>
  );
}

// ---------- Ask (streamed; Round 7 F1/F2) ----------

type Msg = {
  role: "user" | "assistant";
  text: string;
  proposal?: Proposal | null;
  /** A problem report the assistant drafted (R8 D3), with the question it answered. */
  report?: ReportFields | null;
  /** Plan mode (R9 C1): the drafted parts list, shown as a card; `target` = the project it was asked for. */
  plan?: Plan | null;
  target?: string | null;
  /** A note the assistant offers to remember (R9 C3). */
  memory?: string | null;
  /** How the question was routed (data / help / unsure) — help answers get how-to follow-ups (R9 C4). */
  route?: string | null;
  mode?: ChatMode;
  question?: string;
  streaming?: boolean;
  error?: boolean;
};
export type ModelState = "idle" | "ok" | "busy";
export type ChatMode = "chat" | "plan";

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

/** "Remember this?" (R9 C3): a preference the user stated, saved only when confirmed. */
function MemoryChip({ note }: { note: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<"ask" | "saving" | "saved" | "gone">("ask");
  if (state === "gone") return null;
  const save = async () => {
    setState("saving");
    const r = await saveMemoryNote(note, "chat").catch(() => null);
    if (!r || "error" in r) {
      setState("gone");
      toast.error(r ? t.memory.sensitive : t.errors.generic);
    } else setState("saved");
  };
  return (
    <div className="rise-in flex flex-wrap items-center gap-2 rounded-[18px] border border-line bg-surface px-3.5 py-2.5" data-ai-memory={state}>
      <Brain className="size-4 shrink-0 text-muted" />
      <span className="min-w-0 flex-1 text-[13px]">
        <span className="text-muted">{t.memory.rememberQ}</span> <b className="font-semibold bidi">“{note}”</b>
      </span>
      {state === "saved" ? (
        <span className="flex items-center gap-1 text-[13px] font-semibold text-ok">
          <Check className="size-4" /> {t.memory.remembered}
        </span>
      ) : (
        <span className="flex gap-1.5">
          <Button size="sm" variant="accent" className="h-9" disabled={state === "saving"} onClick={() => void save()} data-ai-memory-save>
            {state === "saving" ? <Spinner /> : <Check />} {t.memory.remember}
          </Button>
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setState("gone")}>
            {t.memory.notNow}
          </Button>
        </span>
      )}
    </div>
  );
}

/** A problem report drafted by the assistant (R8 D3): same confirm pattern as actions — Send / Edit / Cancel. */
function ReportDraftCard({ draft, exchange }: { draft: ReportFields; exchange: { question: string; answer: string } }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const [state, setState] = useState<"draft" | "sending" | "sent" | "gone">("draft");
  if (state === "gone") return null;
  const send = async () => {
    setState("sending");
    try {
      await createReport({ ...draft, diag: collectDiag(s.view.type, locale, extensionVersion()), assistant: exchange });
      setState("sent");
      toast.success(t.report.sent, { action: { label: t.report.view, onClick: () => s.setReportsOpen(true) } });
    } catch {
      setState("draft");
      toast.error(t.errors.generic);
    }
  };
  return (
    <div className="rise-in space-y-2.5 rounded-[20px] border border-line bg-surface p-4" data-ai-report-card={state}>
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-muted">
        <Bug className="size-4" /> {t.report.draft}
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-bold text-ink">{t.report[draft.type]}</span>
      </div>
      <div className="text-[15px] font-bold leading-snug bidi">{draft.title}</div>
      {draft.happened && <p className="line-clamp-3 text-[13.5px] text-muted bidi">{draft.happened}</p>}
      {state === "sent" ? (
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ok">
          <Check className="size-4" /> {t.report.sentCard}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-0.5">
          <Button size="sm" variant="accent" className="h-10" disabled={state === "sending"} onClick={() => void send()} data-ai-report-send>
            {state === "sending" ? <Spinner /> : <Send />} {t.report.send}
          </Button>
          <Button size="sm" variant="outline" className="h-10" onClick={() => s.openReport({ ...draft, assistant: exchange })}>
            {t.report.edit}
          </Button>
          <Button size="sm" variant="ghost" className="h-10" onClick={() => setState("gone")}>
            {t.report.cancel}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Runs an action button from an answer (whitelist: lib/help/links.ts). */
function useNexusAction() {
  const s = useStore();
  const { setTheme } = useTheme();
  return (a: NexusAction) => {
    if (a.startsWith("palette/")) return applyPalette(a.slice(8) as "graphite" | "plum");
    if (a.startsWith("theme/")) return setTheme(a.slice(6));
    if (a === "plan") return s.setPanel("planner");
    if (a === "report") return s.openReport({ assistant: getLastExchange() });
    s.setPanel(null);
    if (a.startsWith("view/")) return s.setView({ type: a.slice(5) } as View);
    if (a === "settings") s.setSettingsOpen(true);
    else if (a === "extension") s.setExtOpen(true);
    else if (a === "alerts") s.setPanel("alerts");
    else if (a === "import") s.setPanel("import");
    else if (a === "receipt") {
      if (window.matchMedia("(max-width: 1023px)").matches) s.setScanner("receipt");
      else s.openReceipt();
    } else if (a === "barcode") s.setScanner("barcode");
    else if (a === "shop") s.setShop("pick");
    else if (a === "commands") s.setPaletteOpen(true);
  };
}

/** Assistant answer: no bubble — a bold lead line, then clean paragraphs/lists; referenced items as mini cards. */
function Answer({ text, streaming, onItem }: { text: string; streaming?: boolean; onItem: (id: string) => void }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  // Phones: a 2-column grid of the first REFS_SHOWN mini cards + "Show all"; desktop: all of them, wrapping.
  const phone = useMedia(PHONE);
  const [allRefs, setAllRefs] = useState(false);
  const run = useNexusAction();
  // While streaming, hide a half-written action block (it is parsed once the answer is complete). Action links
  // ([label](nexus:…)) become buttons under the answer.
  const { text: shown, actions } = extractActions(streaming ? text.split("```")[0] : text);
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
      {!streaming && actions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1" data-ai-actions>
          {actions.map((a, k) => (
            <button
              key={a.action}
              type="button"
              onClick={() => run(a.action)}
              className={cn(
                "rise-in inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-start text-[13px] font-bold transition active:scale-[0.97]",
                k === 0 ? "bg-brand text-on-brand hover:bg-brand-hover" : "border border-line bg-surface text-ink hover:bg-surface-2",
              )}
              style={{ animationDelay: `${k * 60}ms` }}
              data-ai-action={a.action}
            >
              {a.label}
              <ArrowUpRight className="size-3.5 shrink-0 opacity-70 rtl:-scale-x-100" />
            </button>
          ))}
        </div>
      )}
      {!streaming && refs.length > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-1 sm:flex sm:flex-wrap" data-ai-refs>
          {(allRefs || !phone ? refs : refs.slice(0, REFS_SHOWN)).map((it, k) => {
            const unit = unitPrice(it, s.rates, s.currency);
            return (
              <button key={it.id} type="button" onClick={() => onItem(it.id)} className="rise-in flex min-w-0 flex-col gap-1.5 rounded-[18px] border border-line bg-surface p-1.5 text-start transition hover:-translate-y-0.5 sm:w-40" style={{ animationDelay: `${k * 50}ms` }}>
                <ProductImage src={it.imageUrl} alt="" className="aspect-[16/11] w-full rounded-[13px]" iconClass="size-5" />
                <span className="line-clamp-2 px-1 text-[12.5px] font-bold leading-snug text-ink bidi">{it.title}</span>
                <span className="flex items-center justify-between gap-1 px-1 pb-0.5">
                  <span className="tabular text-[13px] font-extrabold text-ink">{unit != null ? formatMoney(unit, s.currency, locale) : "—"}</span>
                  {it.status === "to_buy" && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        s.setPanel(null);
                        s.setCompareItemId(it.id);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), s.setPanel(null), s.setCompareItemId(it.id))}
                      className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-ink hover:bg-line"
                      data-ai-compare
                    >
                      {t.compare.short}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {!streaming && phone && !allRefs && refs.length > REFS_SHOWN && (
        <button type="button" onClick={() => setAllRefs(true)} className="h-10 rounded-full px-2 text-[13px] font-semibold text-muted transition hover:text-fg" data-ai-refs-all>
          {f(t.ai.showAll, { n: refs.length })}
        </button>
      )}
    </div>
  );
}

const REFS_SHOWN = 4;

/** First paragraph: its first sentence is the lead line. */
function splitLead(lines: string[]): [string | null, ...string[]] {
  const first = lines[0];
  const m = first.match(/^(.+?[.!?:])(\s+)(.+)$/);
  if (m && m[1].length >= 12) return [m[1], m[3], ...lines.slice(1)];
  return [first, ...lines.slice(1)];
}

// The conversation this page is in (kept while the panel closes and reopens) and when it was last used.
let currentConversation: string | null = null;
let lastActive = 0;
// Set by "New chat" (and opening another conversation): the next mount must not fall back to the latest one.
let freshChat = false;
// Seeds already sent on this page (R14 A1): outside the component so a remount (New chat, reopen) can't resend one.
const sentSeeds = new Set<string>();
const REOPEN_MS = 2 * 3600_000;
const fromStored = (m: MessageView): Msg => ({
  role: m.role,
  text: m.text,
  plan: (m.data?.plan as Plan | undefined) ?? null,
  target: (m.data?.target as string | undefined) ?? null,
  mode: (m.data?.mode as ChatMode | undefined) ?? undefined,
});

function ChatTab({ seed, seedKey, onModel, mode, setMode, onConversation }: { seed: string | null; seedKey: string | null; onModel: (m: ModelState) => void; mode: ChatMode; setMode: (m: ChatMode) => void; onConversation: (c: { id: string; title: string } | null) => void }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const conv = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const currentProject = s.view.type === "collection" ? (s.view as { id: string }).id : null;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [recent, setRecent] = useState<string[]>(() => (typeof window === "undefined" ? [] : readRecent()));
  const [now] = useState(() => Date.now());

  // His usual store, from the same profile the assistant uses (pure, computed from data already here) — R9 C4.
  const topStore = useMemo(() => computeProfile(s.items, s.collections, s.rates, s.currency, now).stores[0]?.store ?? null, [s.items, s.collections, s.rates, s.currency, now]);
  // Titles of recent conversations count as "recently asked" (don't offer what was just discussed).
  const [recentTitles, setRecentTitles] = useState<string[]>([]);
  useEffect(() => {
    let gone = false;
    void listConversations({ limit: 8 })
      .then((r) => !gone && setRecentTitles(r.map((c) => c.title).filter(Boolean)))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, []);
  const base = { items: s.items, collections: s.collections, altGroups: s.altGroups, view: s.view, now, rates: s.rates, currency: s.currency, t: t.ai.sug, topStore, helpQuestions: t.ai.helpSug };
  const suggestions = useMemo(
    () => suggestQuestions({ ...base, recent: [...recent, ...recentTitles], fallback: [t.ai.ex1, t.ai.ex2, t.ai.ex3, t.ai.ex4] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.items, s.collections, s.altGroups, s.view, s.rates, s.currency, t, recent, recentTitles, now, topStore],
  );
  const lastIsAnswer = !busy && msgs.length > 0 && msgs[msgs.length - 1].role === "assistant" && !msgs[msgs.length - 1].error;
  const lastMsg = msgs[msgs.length - 1];
  const followUps = useMemo(
    () =>
      lastIsAnswer
        ? suggestQuestions({
            ...base,
            recent: [...msgs.filter((m) => m.role === "user").map((m) => m.text), ...recent],
            last: { question: lastMsg.question ?? msgs.filter((m) => m.role === "user").at(-1)?.text ?? "", route: lastMsg.route ?? null },
            fallback: [t.ai.ex1, t.ai.ex2, t.ai.ex3, t.ai.ex4],
            limit: 3,
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lastIsAnswer, msgs, s.items, s.collections, s.altGroups, s.view, s.rates, s.currency, t, recent, now],
  );

  const patchLast = (fn: (m: Msg) => Msg) => setMsgs((list) => (list.length ? [...list.slice(0, -1), fn(list[list.length - 1])] : list));

  // Open: the conversation of this page if it was used in the last 2 h, else the latest saved one if it's that recent,
  // else a new one (a seeded question always starts fresh unless a conversation is already open).
  useEffect(() => {
    let gone = false;
    if (currentConversation && Date.now() - lastActive > REOPEN_MS) currentConversation = null;
    const fresh = freshChat;
    freshChat = false;
    const load = currentConversation ? getConversation(currentConversation) : seed || fresh ? Promise.resolve(null) : latestConversation();
    void load
      .catch(() => null)
      .then((r) => {
        if (gone) return;
        if (r) {
          conv.current = r.conversation.id;
          currentConversation = r.conversation.id;
          onConversation({ id: r.conversation.id, title: r.conversation.title });
          // eslint-disable-next-line react-hooks/set-state-in-effect -- loaded asynchronously
          setMsgs((now) => [...r.messages.map(fromStored), ...now]);
        }
        setLoading(false);
      });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Save the exchange (the first one creates the conversation, which then gets a title from the model). */
  const persist = async (m: ChatMode, user: string, answer: string, data: Record<string, unknown>) => {
    lastActive = Date.now();
    try {
      const r = await saveExchange({ conversationId: conv.current, mode: m, user: { text: user, data: { mode: m } }, assistant: { text: answer, data: { ...data, mode: m } } });
      conv.current = r.conversation.id;
      currentConversation = r.conversation.id;
      onConversation({ id: r.conversation.id, title: r.conversation.title });
      if (r.created) onConversation({ id: r.conversation.id, title: await titleConversation(r.conversation.id, locale) });
    } catch {
      // Saving is best effort; the chat goes on.
    }
  };

  // Plan mode: the message is a project description → the planner → a plan card in the chat; then back to Chat.
  const sendPlan = async (text: string) => {
    setMsgs((m) => [...m, { role: "user", text, mode: "plan" }]);
    setQ("");
    setBusy(true);
    try {
      const r = await planWithAi({ description: text, budget: null, currency: s.currency, locale, collectionId: currentProject });
      if ("error" in r) setMsgs((m) => [...m, { role: "assistant", text: r.error === "no_ai" ? t.ai.noAi : t.ai.failed, error: true }]);
      else {
        setMsgs((m) => [...m, { role: "assistant", text: r.summary || r.projectName, plan: r, target: currentProject, mode: "plan", question: text }]);
        setLastExchange(text, `${r.projectName}: ${r.parts.map((p) => p.name).join(", ")}`);
        void persist("plan", text, r.summary || r.projectName, { plan: r, target: currentProject });
      }
    } catch {
      setMsgs((m) => [...m, { role: "assistant", text: t.ai.failed, error: true }]);
    } finally {
      setBusy(false);
      setMode("chat");
    }
  };

  const send = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    if (mode === "plan") return sendPlan(text);
    setRecent(recordRecent(text));
    const history = msgs.filter((m) => !m.error).map(({ role, text }) => ({ role, text }));
    setMsgs((m) => [...m, { role: "user", text }]);
    setQ("");
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    let started = false;
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: text, history, currency: s.currency, locale, diag: collectDiag(s.view.type, locale, extensionVersion()), conversationId: conv.current }), signal: ctrl.signal });
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
          const ev = JSON.parse(line) as { t: "route"; fallback: boolean } | { t: "delta"; text: string } | { t: "done"; text: string; proposal: Proposal | null; report?: ReportFields | null; memory?: string | null; route?: string } | { t: "error"; error: string };
          if (ev.t === "route") onModel(ev.fallback ? "busy" : "ok");
          else if (ev.t === "delta") {
            if (!started) {
              started = true;
              setMsgs((m) => [...m, { role: "assistant", text: ev.text, streaming: true }]);
            } else patchLast((m) => ({ ...m, text: m.text + ev.text }));
          } else if (ev.t === "done") {
            if (!started) setMsgs((m) => [...m, { role: "assistant", text: ev.text, proposal: ev.proposal, report: ev.report, memory: ev.memory, route: ev.route ?? null, question: text }]);
            else patchLast((m) => ({ ...m, text: ev.text, proposal: ev.proposal, report: ev.report, memory: ev.memory, route: ev.route ?? null, question: text, streaming: false }));
            setLastExchange(text, ev.text);
            // Proposals and report drafts are kept as text only: reopened later they must not be applied/sent twice.
            void persist("chat", text, ev.text, { route: ev.route ?? null });
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
    if (seed && seedKey && !sentSeeds.has(seedKey)) {
      const timer = setTimeout(() => {
        sentSeeds.add(seedKey);
        s.consumeAskSeed();
        void send(seed);
      }, 0);
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
        {!msgs.length && !loading && (
          <div className="flex flex-col items-start gap-3 pt-6">
            <BoxThinking className="size-10 [&_path]:animate-none" />
            <p className="text-[15px] font-semibold text-ink">{mode === "plan" ? t.ai.planIntro : t.ai.askIntro}</p>
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
              {m.error ? <p className="text-sm text-muted">{m.text}</p> : m.plan ? <PlanCard plan={m.plan} defaultTarget={m.target ?? null} /> : <Answer text={m.text} streaming={m.streaming} onItem={openItem} />}
              {m.proposal && <ActionCard proposal={m.proposal} onItem={openItem} />}
              {m.memory && <MemoryChip note={m.memory} />}
              {m.report && <ReportDraftCard draft={m.report} exchange={{ question: m.question ?? "", answer: m.text }} />}
            </div>
          ),
        )}
        {waiting && <Waiting />}
        {followUps.length > 0 && (
          <div className="rise-in">
            <Chips list={followUps} onPick={(q) => void send(q)} label={t.ai.followUps} heading={t.ai.followUps} testId="ai-followups" compact />
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="flex flex-col gap-2 border-t border-line px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        {!msgs.length && !loading && mode === "chat" && <Chips list={suggestions} onPick={(q) => void send(q)} label={t.ai.suggestions} heading={t.ai.suggested} testId="ai-suggestions" />}
        {/* Mode switch, like the "thinking" toggles in AI apps: the next message is a chat question or a plan request. */}
        <div role="radiogroup" aria-label={t.ai.modeLabel} className="flex gap-1.5" data-ai-mode={mode}>
          {(["chat", "plan"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={mode === k}
              onClick={() => setMode(k)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition active:scale-[0.97] [&_svg]:size-4",
                mode === k ? (k === "plan" ? "border-transparent bg-[image:var(--act-plan)] text-[var(--act-plan-ink)]" : "border-transparent bg-ink text-bg") : "border-line text-muted hover:text-ink",
              )}
              data-ai-mode-option={k}
            >
              {k === "chat" ? <MessageSquare /> : <Wand2 />}
              {k === "chat" ? t.ai.modeChat : t.ai.planTab}
            </button>
          ))}
        </div>
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
            placeholder={mode === "plan" ? t.ai.planHere : t.ai.askPlaceholder}
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

// ---------- Panel ----------

/**
 * Desktop: a 420 px side panel that slides in with a spring. Phone: the shared bottom sheet (handle, swipe down to
 * close — `Sheet`). Header: Box + "Nexus" + model status dot, new chat, close.
 */
export function AssistantPanel() {
  const s = useStore();
  const seed = s.askSeed ? s.askSeed.split("\u200b")[0] : null;
  const seedKey = s.askSeed;
  const { t } = useI18n();
  const [chat, setChat] = useState(0);
  const [model, setModel] = useState<ModelState>("idle");
  const [mode, setMode] = useState<ChatMode>("chat");
  const [pane, setPane] = useState<"chat" | "history">("chat");
  const [conv, setConv] = useState<{ id: string; title: string } | null>(null);
  const newChat = () => {
    currentConversation = null;
    freshChat = true;
    lastActive = Date.now();
    setConv(null);
    setPane("chat");
    setChat((n) => n + 1);
  };
  const open = s.panel === "assistant" || s.panel === "planner";
  // "Plan with Nexus" (+ menu, project page) opens the one chat in Plan mode.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the entry point picks the mode
    if (s.panel === "planner") setMode("plan");
  }, [s.panel]);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && s.setPanel(null)} title={t.ai.title} className="assistant-sheet sm:max-w-[420px]">
      <div className="flex h-full flex-col" data-assistant>
        <div className="flex items-center gap-2 px-4 pb-2 pt-1 sm:pt-4" data-sheet-grip data-ai-header>
          {/* Round 12 #3: History at the start, before the mark — a separate control (hairline between), mirrored in RTL. */}
          <button
            type="button"
            onClick={() => setPane(pane === "history" ? "chat" : "history")}
            aria-pressed={pane === "history"}
            className={cn("-ms-1.5 grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink", pane === "history" && "bg-surface-2 text-ink")}
            aria-label={t.chats.open}
            title={t.chats.open}
            data-ai-history-open
          >
            <History className="size-[18px]" />
          </button>
          <span className="h-5 w-px shrink-0 bg-line" aria-hidden />
          <LogoMark className="size-7" />
          <span className="min-w-0">
            <span className="block text-[17px] font-extrabold leading-tight tracking-[-0.02em]">Nexus</span>
            {conv?.title && pane === "chat" && <span className="block max-w-[46vw] truncate text-[12px] leading-tight text-muted bidi sm:max-w-[200px]" data-ai-title>{conv.title}</span>}
          </span>
          <span
            className={cn("size-2 rounded-full", model === "busy" ? "bg-spark" : model === "ok" ? "bg-ok" : "bg-line-strong")}
            title={model === "busy" ? t.ai.modelBusy : model === "ok" ? t.ai.modelOk : undefined}
            aria-label={model === "busy" ? t.ai.modelBusy : model === "ok" ? t.ai.modelOk : undefined}
            data-ai-model={model}
          />
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => s.openReport({ assistant: getLastExchange() })}
            className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12.5px] font-semibold text-muted hover:bg-surface-2 hover:text-ink"
            title={t.report.menu}
            data-ai-report
          >
            <MessageSquareWarning className="size-4" />
            <span className="max-sm:sr-only">{t.report.menu}</span>
          </button>
          {(
            <button type="button" onClick={newChat} className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label={t.ai.newChat} title={t.ai.newChat} data-ai-new>
              <SquarePen className="size-[18px]" />
            </button>
          )}
          <SheetClose className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <X className="size-[18px]" />
          </SheetClose>
        </div>
        {pane === "history" ? (
          <HistoryList
            currentId={conv?.id ?? null}
            onBack={() => setPane("chat")}
            onOpen={(id) => {
              currentConversation = id;
              lastActive = Date.now();
              setPane("chat");
              setChat((n) => n + 1);
            }}
          />
        ) : (
          <ChatTab key={chat} seed={seed} seedKey={seedKey} onModel={setModel} mode={mode} onConversation={setConv} setMode={(m) => (setMode(m), m === "chat" && s.panel === "planner" && s.setPanel("assistant"))} />
        )}
      </div>
    </Sheet>
  );
}
