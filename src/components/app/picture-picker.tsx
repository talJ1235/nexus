"use client";

import { useFailReport } from "./fail-toast";
import { useEffect, useRef, useState } from "react";
import { Camera, Check, ImageOff, Search, Smile, Upload } from "lucide-react";
import { pictureIcons, searchPictures } from "@/app/picture-actions";
import { useI18n } from "@/components/providers";
import { Button, Input } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { Spinner } from "@/components/ui/spinner";
import type { Candidate } from "@/lib/picture-rank";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { photoToDataUrl } from "./use-camera";

export type PictureChoice = { url: string | null; source: Candidate["source"] | "photo" };

/**
 * Picture picker (Round 10 D4): the ranked alternatives, a search box (Hebrew or English), Take a photo, Upload,
 * Use an icon, No picture. One tap chooses; the chosen tile pops before the sheet closes.
 */
export function PicturePicker({
  open,
  onOpenChange,
  title,
  current,
  candidates,
  loading,
  keyword,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  current: string | null;
  candidates: Candidate[];
  loading?: boolean;
  keyword: string;
  onPick: (c: PictureChoice) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const { fail } = useFailReport();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState<"search" | "icon" | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset when closed */
    setFound(null);
    setQ("");
    setPicked(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  const choose = (c: PictureChoice, key: string) => {
    setPicked(key);
    setTimeout(async () => {
      await onPick(c);
      onOpenChange(false);
    }, 260);
  };
  const run = async (kind: "search" | "icon") => {
    setBusy(kind);
    try {
      setFound(kind === "search" ? await searchPictures({ query: q.trim() }) : await pictureIcons({ keyword }));
    } catch (e) {
      fail("picture", { code: `${kind}:${String((e as Error)?.message || "error").slice(0, 30)}` });
    } finally {
      setBusy(null);
    }
  };
  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      choose({ url: await photoToDataUrl(file, 480, 0.82), source: "photo" }, "photo");
    } catch {
      toast.error(t.errors.generic);
    }
  };
  const list = found ?? candidates;

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t.pictures.pickerTitle} description={title} className="max-w-lg">
      <div className="flex flex-col gap-3" data-picture-picker>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) void run("search");
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.pictures.search} aria-label={t.pictures.search} className="h-11 flex-1 rounded-full" data-picture-search />
          <Button type="submit" variant="outline" className="h-11 rounded-full px-4" disabled={!q.trim() || !!busy} aria-label={t.pictures.searchBtn}>
            {busy === "search" ? <Spinner /> : <Search />}
          </Button>
        </form>
        {loading && !found ? (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="skeleton aspect-square rounded-[18px]" />
            ))}
          </div>
        ) : list.length ? (
          <>
            <p className="text-xs text-muted">{t.pictures.pickerHint}</p>
            <div className="grid grid-cols-3 gap-2" data-picture-grid>
              {list.map((c) => (
                <button
                  key={c.url}
                  type="button"
                  onClick={() => choose({ url: c.url, source: c.source }, c.url)}
                  className={cn(
                    "pic-paper group relative aspect-square overflow-hidden rounded-[18px] border p-1.5 transition active:scale-95",
                    c.url === current ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-ink/40",
                    picked === c.url && "animate-pop-in ring-4 ring-accent",
                  )}
                  aria-label={c.title ?? t.pictures.sources[c.source]}
                  data-picture-choice={c.source}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote pictures from many hosts */}
                  <img src={c.url} alt="" className="size-full object-contain" loading="lazy" referrerPolicy="no-referrer" />
                  <span className="nx-tag absolute inset-x-1 bottom-1 justify-center" data-tone={c.url === current ? "ink" : undefined}>
                    {c.url === current ? t.pictures.current : t.pictures.sources[c.source]}
                  </span>
                  {picked === c.url && (
                    <span className="absolute end-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-ink text-bg">
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="rounded-[18px] bg-surface-2 p-4 text-sm text-muted">{t.pictures.noResults}</p>
        )}
        <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void fromFile(e.target.files?.[0])} />
        <input ref={uploadRef} type="file" accept="image/*" hidden onChange={(e) => void fromFile(e.target.files?.[0])} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button variant="outline" className="h-11 rounded-full" onClick={() => photoRef.current?.click()} data-picture-photo>
            <Camera /> {t.pictures.takePhoto}
          </Button>
          <Button variant="outline" className="h-11 rounded-full" onClick={() => uploadRef.current?.click()} data-picture-upload>
            <Upload /> {t.pictures.upload}
          </Button>
          <Button variant="outline" className="h-11 rounded-full" onClick={() => void run("icon")} disabled={!!busy} data-picture-icon>
            {busy === "icon" ? <Spinner /> : <Smile />} {t.pictures.useIcon}
          </Button>
          <Button variant="outline" className="h-11 rounded-full" onClick={() => choose({ url: null, source: "photo" }, "none")} data-picture-none>
            <ImageOff /> {t.pictures.none}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
