"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, MessageSquare, Pencil, Search, Trash2, Wand2 } from "lucide-react";
import { deleteConversation, listConversations, renameConversation, restoreConversation, type ConversationView } from "@/app/chat-actions";
import { useI18n } from "@/components/providers";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Conversation history (Round 9 C2): search (titles + messages), grouped Today / This week / Earlier; open to
 * continue, rename in place, delete with Undo. Fills the assistant panel (full screen on phones).
 */
export function HistoryList({ currentId, onOpen, onBack }: { currentId: string | null; onOpen: (id: string) => void; onBack: () => void }) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ConversationView[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let gone = false;
    const timer = setTimeout(
      () =>
        void listConversations({ query: query.trim() || undefined })
          .then((r) => !gone && setRows(r))
          .catch(() => !gone && setRows([])),
      query ? 220 : 0,
    );
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [query]);

  const groups = useMemo(() => {
    if (!rows) return [];
    if (query.trim()) return [{ key: "found", label: null as string | null, rows }];
    const d = new Date(now);
    const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const week = today - 6 * 86_400_000;
    const g = [
      { key: "today", label: t.chats.today, rows: rows.filter((r) => r.updatedAt >= today) },
      { key: "week", label: t.chats.week, rows: rows.filter((r) => r.updatedAt < today && r.updatedAt >= week) },
      { key: "earlier", label: t.chats.earlier, rows: rows.filter((r) => r.updatedAt < week) },
    ];
    return g.filter((x) => x.rows.length);
  }, [rows, query, t, now]);

  const when = (ms: number) =>
    new Date(ms).toLocaleString(locale === "he" ? "he-IL" : "en-GB", now - ms < 86_400_000 ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" });

  const remove = async (c: ConversationView) => {
    setRows((r) => r?.filter((x) => x.id !== c.id) ?? r);
    try {
      await deleteConversation(c.id);
      toast.success(t.chats.deleted, {
        action: {
          label: t.item.undo,
          onClick: () =>
            void restoreConversation(c.id).then(() => setRows((r) => (r ? [...r, c].sort((a, b) => b.updatedAt - a.updatedAt) : r))),
        },
      });
    } catch {
      setRows((r) => (r ? [...r, c].sort((a, b) => b.updatedAt - a.updatedAt) : r));
      toast.error(t.errors.generic);
    }
  };
  const saveTitle = async () => {
    if (!editing) return;
    const title = editing.title.trim();
    setEditing(null);
    if (!title) return;
    setRows((r) => r?.map((x) => (x.id === editing.id ? { ...x, title } : x)) ?? r);
    await renameConversation(editing.id, title).catch(() => toast.error(t.errors.generic));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-ai-history>
      <div className="flex items-center gap-2 px-4 pb-3">
        <button type="button" onClick={onBack} className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label={t.chats.back}>
          <ArrowLeft className="size-[18px] rtl:-scale-x-100" />
        </button>
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-surface-2 px-3.5 text-muted focus-within:border-ink/30">
          <Search className="size-4 shrink-0" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.chats.search} aria-label={t.chats.search} className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-muted" dir="auto" data-ai-history-search />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[max(16px,env(safe-area-inset-bottom))]">
        {!rows ? (
          <div className="grid place-items-center py-14">
            <Spinner />
          </div>
        ) : !groups.length ? (
          <p className="px-4 py-12 text-center text-sm text-muted">{query.trim() ? t.chats.noMatch : t.chats.empty}</p>
        ) : (
          groups.map((g) => (
            <section key={g.key} className="mb-3">
              {g.label && <h3 className="px-2 pb-1 pt-2 text-[12px] font-bold uppercase tracking-wide text-muted">{g.label}</h3>}
              <ul>
                {g.rows.map((c) => (
                  <li key={c.id} className={cn("group flex items-center gap-1 rounded-[16px] pe-1 transition hover:bg-surface-2", c.id === currentId && "bg-surface-2")} data-ai-history-row>
                    {editing?.id === c.id ? (
                      <form
                        className="flex min-w-0 flex-1 items-center gap-1 p-1.5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveTitle();
                        }}
                      >
                        <input autoFocus value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} onBlur={() => void saveTitle()} maxLength={80} className="h-10 min-w-0 flex-1 rounded-[12px] border border-line bg-surface px-3 text-[14px] outline-none" dir="auto" />
                        <button type="submit" className="grid size-10 place-items-center rounded-full text-ink" aria-label={t.chats.rename}>
                          <Check className="size-4" />
                        </button>
                      </form>
                    ) : (
                      <>
                        <button type="button" onClick={() => onOpen(c.id)} className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-start">
                          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted group-hover:bg-surface [&_svg]:size-4">{c.modes.includes("plan") ? <Wand2 /> : <MessageSquare />}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold bidi">{c.title || t.chats.untitled}</span>
                            {c.snippet ? <span className="line-clamp-2 block text-[12px] text-muted bidi">{c.snippet}</span> : <span className="block text-[12px] text-muted">{when(c.updatedAt)}</span>}
                          </span>
                        </button>
                        <button type="button" onClick={() => setEditing({ id: c.id, title: c.title })} className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:text-ink sm:opacity-0 sm:group-hover:opacity-100" aria-label={t.chats.rename}>
                          <Pencil className="size-4" />
                        </button>
                        <button type="button" onClick={() => void remove(c)} className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:text-danger sm:opacity-0 sm:group-hover:opacity-100" aria-label={t.chats.delete} data-ai-history-delete>
                          <Trash2 className="size-4" />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
