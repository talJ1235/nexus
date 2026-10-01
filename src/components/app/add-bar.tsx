"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Link2, ListPlus, Plus, ReceiptText, X } from "lucide-react";
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
import { useReadOnly } from "./offline-banner";

export type Incoming = { url?: string; payload?: ClientPayload } | null;

type DupPrompt = { preview: PreviewResult; resolve: (choice: "source" | "separate" | "cancel") => void };

/** Views whose grid/table shows placeholder cards for links being read. Elsewhere the add bar shows a small status line. */
export const SHOWS_PENDING = ["to_buy", "urgent", "unsorted", "collection", "store"];

export function AddBar({ incoming, collapsed }: { incoming?: Incoming; collapsed?: boolean }) {
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

  // Pasting a link anywhere (outside a text field) adds it, like pasting into the capsule.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]') || ro.ro) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (!extractUrls(text).length) return;
      e.preventDefault();
      void submit(text);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  // Phone: "+ → Paste a link" opens the field above the dock; a link already on the clipboard is added right away.
  useEffect(() => {
    if (!s.pasteOpen) return;
    inputRef.current?.focus();
    navigator.clipboard
      ?.readText?.()
      .then((text) => {
        if (extractUrls(text).length && !inputRef.current?.value) {
          s.setPasteOpen(false);
          void submit(text);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.pasteOpen]);

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
  const ro = useReadOnly();

  return (
    <>
      {/* Soft fade so the grid passes under the capsule. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none fixed bottom-0 end-0 z-[25] h-[140px] bg-gradient-to-b from-transparent to-bg to-70% transition-[inset-inline-start] duration-[450ms] ease-[var(--ease-out)] max-lg:start-0 max-lg:h-[130px]",
          collapsed ? "lg:start-[100px]" : "lg:start-[272px]",
        )}
      />
      <div
        data-paste-capsule
        className={cn(
          "fixed z-30 flex flex-col items-center gap-2 transition-[inset-inline-start,opacity,transform] duration-[450ms] ease-[var(--ease-out)] lg:bottom-[26px] lg:end-[26px] [body:has([data-selection-bar])_&]:pointer-events-none [body:has([data-selection-bar])_&]:opacity-0",
          "max-lg:inset-x-3 max-lg:bottom-[calc(100px+env(safe-area-inset-bottom))]",
          !s.pasteOpen && "max-lg:pointer-events-none max-lg:translate-y-4 max-lg:opacity-0",
          collapsed ? "lg:start-[112px]" : "lg:start-[284px]",
        )}
      >
        {!SHOWS_PENDING.includes(s.view.type) && s.pending.length > 0 && (
          <ul className="flex max-w-[620px] flex-wrap justify-center gap-1.5" aria-live="polite">
            {s.pending.slice(0, 4).map((p) => (
              <li
                key={p.id}
                className={cn(
                  "flex max-w-[300px] animate-pop-in items-center gap-2 rounded-full border py-1 pe-1.5 ps-2.5 text-xs shadow-card",
                  p.state === "failed" ? "border-danger/40 bg-danger-soft text-danger" : "border-line bg-surface text-tint-ink",
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
        <div className="flow-border w-full max-w-[620px] rounded-full shadow-[0_18px_44px_color-mix(in_srgb,var(--ink)_22%,transparent)]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(value);
              s.setPasteOpen(false);
            }}
            className="group flex h-[58px] items-center gap-1.5 rounded-full bg-surface pe-[5px] ps-5 text-muted lg:h-[58px]"
          >
            <Link2 className="pointer-events-none size-[19px] shrink-0 text-ink" strokeWidth={1.8} />
            <input
              id="add-input"
              ref={inputRef}
              disabled={ro.ro}
              title={ro.title}
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
              onBlur={() => !value.trim() && setTimeout(() => s.setPasteOpen(false), 150)}
              onKeyDown={(e) => e.key === "Escape" && s.setPasteOpen(false)}
              placeholder={t.shell.pastePrompt}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-[15px] text-ink outline-none placeholder:text-muted"
              aria-label={t.add.placeholder}
            />
            {!value && <span className="me-1 hidden shrink-0 rounded-[7px] bg-surface-2 px-2 py-[3px] text-xs lg:inline">{t.shell.pasteKey}</span>}
            <button
              type="button"
              onClick={() => setBulk(true)}
              disabled={ro.ro}
              className="hidden size-10 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50 sm:grid"
              title={t.add.bulk}
              aria-label={t.add.bulk}
            >
              <ListPlus className="size-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => s.openReceipt()}
              disabled={ro.ro}
              className="inline-flex h-12 shrink-0 items-center gap-[7px] rounded-full bg-surface-2 px-4 text-[14px] font-bold text-ink transition hover:bg-line disabled:opacity-50 max-sm:w-12 max-sm:justify-center max-sm:px-0"
              title={t.scan.title}
              aria-label={t.scan.title}
              data-receipt-open="add"
            >
              <ReceiptText className="size-[17px]" />
              <span className="max-sm:hidden">{t.scan.button}</span>
            </button>
            <button
              type="submit"
              className="inline-flex h-12 shrink-0 items-center gap-[7px] rounded-full bg-brand px-[18px] text-[14px] font-bold text-on-brand transition hover:bg-brand-hover active:scale-[0.97] disabled:opacity-60"
              disabled={ro.ro || (!isHttpUrl(value.trim()) && !extractUrls(value).length)}
            >
              {working ? <Spinner /> : <Plus className="size-[17px]" strokeWidth={2.4} />}
              <span className="max-sm:hidden">{t.add.add}</span>
            </button>
          </form>
        </div>
      </div>

      <Modal open={bulk} onOpenChange={setBulk} title={t.add.bulk}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBulk(false);
            void submit(value);
          }}
        >
          <Textarea autoFocus rows={6} value={value} onChange={(e) => setValue(e.target.value)} placeholder={t.add.placeholderMany} dir="ltr" />
          <div className="flex items-center justify-between gap-2 pt-3">
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
      </Modal>

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
    </>
  );
}
