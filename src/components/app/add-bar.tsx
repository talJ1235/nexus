"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Link2, ListPlus, Plus, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/lib/toast";
import { addSource, createItem, previewFromClient, previewUrl, updateItem } from "@/app/actions";
import type { ClientPayload } from "@/lib/service";
import { useI18n } from "@/components/providers";
import { Button, Textarea } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import type { ItemWithSources, PreviewResult } from "@/lib/types";
import { cn, extractUrls, isHttpUrl } from "@/lib/utils";
import { hostOf, normalizeUrl } from "@/lib/stores";
import { useStore } from "./store";
import { useExtension } from "./use-extension";

export type Incoming = { url?: string; payload?: ClientPayload } | null;

type DupPrompt = { preview: PreviewResult; resolve: (choice: "source" | "separate" | "cancel") => void };

/** Views whose grid/table shows placeholder cards for links being read. Elsewhere the add bar shows a small status line. */
export const SHOWS_PENDING = ["to_buy", "urgent", "unsorted", "collection", "store"];

export function AddBar({ incoming }: { incoming?: Incoming }) {
  const s = useStore();
  const { t, f } = useI18n();
  const [value, setValue] = useState("");
  const [bulk, setBulk] = useState(false);
  const [dup, setDup] = useState<DupPrompt | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ext = useExtension();
  const started = useRef(false);
  // Latest items for duplicate checks inside long-running adds (avoids stale closures).
  const itemsRef = useRef(s.items);
  useEffect(() => {
    itemsRef.current = s.items;
  }, [s.items]);
  const viewRef = useRef(s.view);
  useEffect(() => {
    viewRef.current = s.view;
  }, [s.view]);

  const hintCollection = s.view.type === "collection" ? s.view.id : null;

  const askDuplicate = (preview: PreviewResult) =>
    new Promise<"source" | "separate" | "cancel">((resolve) => setDup({ preview, resolve }));

  /** The exact link is already on the to-buy list: one more of it, with undo. */
  const bump = useCallback(
    async (existing: ItemWithSources) => {
      const current = itemsRef.current.find((i) => i.id === existing.id) ?? existing;
      const qty = current.quantity + 1;
      s.upsertItem({ ...current, quantity: qty });
      s.markFresh(current.id, "bump");
      const req = updateItem(current.id, { quantity: qty });
      let undone = false;
      let id: string | number | undefined;
      try {
        id = toast.success(f(t.add.bumped, { n: qty }), {
          description: current.title,
          action: {
            label: t.item.undo,
            onClick: async () => {
              undone = true;
              await req.catch(() => null);
              const now = itemsRef.current.find((i) => i.id === current.id);
              const back = Math.max(1, (now?.quantity ?? qty) - 1);
              if (now) s.upsertItem({ ...now, quantity: back });
              s.upsertItem(await updateItem(current.id, { quantity: back }));
            },
          },
        });
        const saved = await req;
        if (!undone) s.upsertItem(saved);
      } catch {
        s.upsertItem(current);
        toast.error(t.errors.generic, { id });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.upsertItem, s.markFresh, t, f],
  );

  type Runner = (input: { url?: string; payload?: ClientPayload }, interactive: boolean) => Promise<void>;
  const runRef = useRef<Runner | null>(null);
  const run = useCallback(
    async (input: { url?: string; payload?: ClientPayload }, interactive: boolean): Promise<void> => {
      const id = Math.random().toString(36).slice(2);
      const url = input.url ?? input.payload?.url ?? null;
      const label = hostOf(url ?? "") || "…";
      // Same link already waiting to be bought → +1, instantly and without reading the page again.
      if (url) {
        const key = normalizeUrl(url);
        const existing = itemsRef.current.find((i) => i.status === "to_buy" && i.sources.some((x) => x.normalizedUrl === key));
        if (existing) return bump(existing);
      }
      s.addPending({ id, label, url, state: "working", collectionId: hintCollection });
      try {
        let payload = input.payload ?? null;
        // With the extension installed, read the page in this browser first: real sessions, no bot walls.
        if (!payload && input.url && ext.available) {
          s.patchPending(id, { label: `${label} · ${t.add.viaBrowser}` });
          const got = await ext.resolve(input.url);
          if (got?.title) payload = { ...got, url: got.url || input.url };
        }
        const preview = payload ? await previewFromClient(payload, hintCollection) : await previewUrl(input.url!, hintCollection);
        let choice: "source" | "separate" | "cancel" = "separate";
        const d = preview.duplicate;
        if (d?.reason === "url") {
          const existing = itemsRef.current.find((i) => i.id === d.itemId);
          // Still to buy → +1. Already ordered/received → buying it again is a new line.
          if (existing?.status === "to_buy") {
            s.dropPending(id);
            return bump(existing);
          }
        } else if (d && interactive) {
          choice = await askDuplicate(preview);
        }
        if (choice === "cancel") {
          s.dropPending(id);
          return;
        }
        const item = choice === "source" && d ? await addSource(d.itemId, preview.draft.source, preview.draft.imageUrl) : await createItem(preview.draft);
        s.dropPending(id);
        s.upsertItem(item);
        s.markFresh(item.id);
        const partial = preview.draft.quality !== "full";
        const v = viewRef.current;
        const visible = v.type === "to_buy" || (v.type === "collection" && v.id === item.collectionId) || (v.type === "unsorted" && !item.collectionId);
        if (preview.draft.quality === "failed") toast.warning(t.add.failed, { action: { label: t.item.edit, onClick: () => s.openItem(item.id) } });
        else if (partial && interactive) toast(t.add.partial, { description: item.title, action: { label: t.item.edit, onClick: () => s.openItem(item.id) } });
        else if (!visible) toast.success(t.add.added, { description: item.title, action: { label: t.dup.open, onClick: () => s.openItem(item.id) } });
      } catch (e) {
        s.patchPending(id, {
          state: "failed",
          retry: () => {
            s.dropPending(id);
            void runRef.current?.(input, interactive);
          },
        });
        if (String((e as Error)?.message) === "invalid_url") toast.error(t.add.invalidUrl);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hintCollection, s.upsertItem, s.openItem, s.addPending, s.patchPending, s.dropPending, s.markFresh, bump, t, ext.available, ext.resolve],
  );

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const runMany = useCallback(
    async (urls: string[]) => {
      const queue = urls.slice();
      const worker = async () => {
        while (queue.length) await run({ url: queue.shift()! }, false);
      };
      await Promise.all([worker(), worker()]);
      toast.success(f(t.add.queue, { done: urls.length, total: urls.length }));
    },
    [run, f, t],
  );

  const submit = async (text: string) => {
    const urls = extractUrls(text);
    if (!urls.length) {
      if (text.trim()) toast.error(t.add.invalidUrl);
      return;
    }
    setValue("");
    setBulk(false);
    if (urls.length === 1) await run({ url: urls[0] }, true);
    else await runMany(urls);
  };

  // Links handed over from the bookmarklet or Android share sheet.
  useEffect(() => {
    if (!incoming || started.current) return;
    const timer = setTimeout(() => {
      started.current = true;
      window.history.replaceState(null, "", "/");
      if (incoming.payload) void run({ payload: incoming.payload }, true);
      else if (incoming.url) void run({ url: incoming.url }, true);
    }, 0);
    return () => clearTimeout(timer);
  }, [incoming, run]);

  // "/" focuses the add bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const working = s.pending.some((p) => p.state === "working");

  return (
    <div className="w-full">
      {!bulk ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(value);
          }}
          className="group relative flex h-12 items-center rounded-xl border border-line-strong bg-surface shadow-card transition focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15"
        >
          <Link2 className="pointer-events-none ms-4 size-[18px] shrink-0 text-faint group-focus-within:text-accent-ink" />
          <input
            id="add-input"
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              const urls = extractUrls(text);
              if (urls.length && !value.trim()) {
                e.preventDefault();
                void submit(text);
              }
            }}
            placeholder={t.add.placeholder}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent px-3 text-[15px] outline-none placeholder:text-faint"
            aria-label={t.add.placeholder}
          />
          <button
            type="button"
            onClick={() => setBulk(true)}
            className="me-1 hidden rounded-lg px-2.5 py-1.5 text-[13px] text-muted transition hover:bg-sunken hover:text-fg sm:inline-flex sm:items-center sm:gap-1.5"
            title={t.add.bulk}
          >
            <ListPlus className="size-4" />
            <span className="hidden md:inline">{t.add.bulk}</span>
          </button>
          <Button type="submit" variant="accent" size="sm" className="me-1.5 h-9 px-3.5" disabled={!isHttpUrl(value.trim()) && !extractUrls(value).length}>
            {working ? <Spinner /> : <Plus />}
            <span className="hidden sm:inline">{t.add.add}</span>
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(value);
          }}
          className="rounded-xl border border-accent bg-surface p-2 shadow-card ring-4 ring-accent/15"
        >
          <Textarea
            autoFocus
            rows={5}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t.add.placeholderMany}
            className="resize-y border-0 bg-transparent focus:ring-0"
            dir="ltr"
          />
          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <span className="tabular text-xs text-faint">{extractUrls(value).length || ""}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setBulk(false)}>
                {t.item.cancel}
              </Button>
              <Button size="sm" variant="accent" type="submit" disabled={!extractUrls(value).length}>
                <Plus />
                {t.add.addAll}
              </Button>
            </div>
          </div>
        </form>
      )}

      {!SHOWS_PENDING.includes(s.view.type) && s.pending.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-live="polite">
          {s.pending.slice(0, 4).map((p) => (
            <li
              key={p.id}
              className={cn(
                "flex max-w-[300px] animate-pop-in items-center gap-2 rounded-full border py-1 pe-1.5 ps-2.5 text-xs",
                p.state === "failed" ? "border-danger/40 bg-danger-soft text-danger" : "border-accent/40 bg-accent-soft text-accent-ink",
              )}
            >
              {p.state === "working" ? <Spinner className="size-3.5" /> : <AlertTriangle className="size-3.5 shrink-0" />}
              <span className="min-w-0 truncate">{p.state === "working" ? `${t.add.fetching} ${p.label}` : `${t.add.couldNotRead} · ${p.label}`}</span>
              {p.state === "failed" && (
                <button type="button" aria-label={t.view.clear} onClick={() => s.dropPending(p.id)} className="rounded-full p-0.5 opacity-70 hover:opacity-100">
                  <X className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={!!dup}
        onOpenChange={(o) => {
          if (!o && dup) {
            dup.resolve("cancel");
            setDup(null);
          }
        }}
        title={t.dup.title}
        description={dup?.preview.duplicate?.reason === "url" ? t.dup.sameUrl : f(t.dup.body, { title: dup?.preview.duplicate?.title ?? "" })}
      >
        {dup && (
          <div className="flex flex-col gap-2">
            {dup.preview.duplicate?.reason !== "url" && (
              <>
                <Button
                  variant="accent"
                  onClick={() => {
                    dup.resolve("source");
                    setDup(null);
                  }}
                >
                  {t.dup.asSource}
                </Button>
                <Button
                  onClick={() => {
                    dup.resolve("separate");
                    setDup(null);
                  }}
                >
                  {t.dup.separate}
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                const id = dup.preview.duplicate?.itemId;
                dup.resolve("cancel");
                setDup(null);
                if (id) s.openItem(id);
              }}
            >
              {t.dup.open}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
