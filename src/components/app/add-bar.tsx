"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Link2, ListPlus, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { addSource, createItem, previewFromClient, previewUrl } from "@/app/actions";
import type { ClientPayload } from "@/lib/service";
import { useI18n } from "@/components/providers";
import { Button, Textarea } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import type { PreviewResult } from "@/lib/types";
import { cn, extractUrls, isHttpUrl } from "@/lib/utils";
import { hostOf } from "@/lib/stores";
import { useStore } from "./store";
import { useExtension } from "./use-extension";

type Job = { id: string; label: string; state: "working" | "done" | "partial" | "skipped" | "failed"; itemId?: string };
export type Incoming = { url?: string; payload?: ClientPayload } | null;

type DupPrompt = { preview: PreviewResult; resolve: (choice: "source" | "separate" | "cancel") => void };

export function AddBar({ incoming }: { incoming?: Incoming }) {
  const s = useStore();
  const { t, f } = useI18n();
  const [value, setValue] = useState("");
  const [bulk, setBulk] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dup, setDup] = useState<DupPrompt | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ext = useExtension();
  const started = useRef(false);

  const hintCollection = s.view.type === "collection" ? s.view.id : null;

  const patchJob = (id: string, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const askDuplicate = (preview: PreviewResult) =>
    new Promise<"source" | "separate" | "cancel">((resolve) => setDup({ preview, resolve }));

  const run = useCallback(
    async (input: { url?: string; payload?: ClientPayload }, interactive: boolean) => {
      const id = Math.random().toString(36).slice(2);
      const label = hostOf(input.url ?? input.payload?.url ?? "") || "…";
      setJobs((js) => [...js, { id, label, state: "working" }]);
      try {
        let payload = input.payload ?? null;
        // With the extension installed, read the page in this browser first: real sessions, no bot walls.
        if (!payload && input.url && ext.available) {
          patchJob(id, { label: `${label} · ${t.add.viaBrowser}` });
          const got = await ext.resolve(input.url);
          if (got?.title) payload = { ...got, url: got.url || input.url };
        }
        const preview = payload ? await previewFromClient(payload, hintCollection) : await previewUrl(input.url!, hintCollection);
        let choice: "source" | "separate" | "cancel" = "separate";
        if (preview.duplicate) {
          if (interactive) choice = await askDuplicate(preview);
          else choice = preview.duplicate.reason === "url" ? "cancel" : "separate";
        }
        if (choice === "cancel") {
          patchJob(id, { state: "skipped", label: preview.duplicate?.title ?? label, itemId: preview.duplicate?.itemId });
          return;
        }
        const item =
          choice === "source" && preview.duplicate
            ? await addSource(preview.duplicate.itemId, preview.draft.source, preview.draft.imageUrl)
            : await createItem(preview.draft);
        s.upsertItem(item);
        const partial = preview.draft.quality !== "full";
        patchJob(id, { state: partial ? "partial" : "done", label: item.title, itemId: item.id });
        if (interactive) {
          if (preview.draft.quality === "failed") toast.warning(t.add.failed, { action: { label: t.item.edit, onClick: () => s.openItem(item.id) } });
          else if (partial) toast(t.add.partial, { description: item.title, action: { label: t.item.edit, onClick: () => s.openItem(item.id) } });
        }
      } catch (e) {
        patchJob(id, { state: "failed" });
        toast.error(String((e as Error)?.message) === "invalid_url" ? t.add.invalidUrl : t.errors.generic);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hintCollection, s.upsertItem, s.openItem, t, ext.available, ext.resolve],
  );

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

  const working = jobs.some((j) => j.state === "working");
  const visibleJobs = jobs.slice(-6);

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
            {working ? <Loader2 className="animate-spin" /> : <Plus />}
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

      {visibleJobs.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-live="polite">
          {visibleJobs.map((j) => (
            <li
              key={j.id}
              className={cn(
                "flex max-w-[280px] animate-pop-in items-center gap-1.5 rounded-full border py-1 pe-1 ps-2.5 text-xs",
                j.state === "failed" ? "border-danger/40 bg-danger-soft text-danger" : j.state === "partial" || j.state === "skipped" ? "border-accent/40 bg-accent-soft text-accent-ink" : "border-line bg-surface text-muted",
              )}
            >
              {j.state === "working" ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : j.state === "done" ? <Check className="size-3.5 shrink-0 text-ok" /> : <AlertTriangle className="size-3.5 shrink-0" />}
              <button type="button" disabled={!j.itemId} onClick={() => j.itemId && s.openItem(j.itemId)} className="min-w-0 truncate text-start disabled:cursor-default">
                {j.state === "working" ? `${t.add.fetching} ${j.label}` : j.label}
              </button>
              {j.state !== "working" && (
                <button type="button" aria-label={t.view.clear} onClick={() => setJobs((js) => js.filter((x) => x.id !== j.id))} className="rounded-full p-0.5 opacity-60 hover:bg-sunken hover:opacity-100">
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
