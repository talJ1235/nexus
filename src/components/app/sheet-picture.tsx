"use client";

import { useState } from "react";
import { Check, ImagePlus } from "lucide-react";
import { approvePictures, itemPictureChoices, setItemPicture } from "@/app/picture-actions";
import { useI18n } from "@/components/providers";
import type { Candidate } from "@/lib/picture-rank";
import { toast } from "@/lib/toast";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProductImage } from "./item-card";
import { PicturePicker } from "./picture-picker";
import { useStore } from "./store";

/**
 * The item sheet's picture (Round 10 D4): "Change picture" on every item opens the picker with its ranked
 * alternatives (searched on first open when it has none); a best guess Nexus isn't sure of carries "Looks right".
 * The picture keeps `data-sheet-img` — it's the card → sheet morph's target.
 */
export function SheetPicture({ item }: { item: ItemWithSources }) {
  const s = useStore();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Candidate[] | null>(null);
  // Only a picture the owner just chose pops into place (not on open: the morph measures this element).
  const [popped, setPopped] = useState(false);

  const openPicker = () => {
    setOpen(true);
    setChoices(item.imageCandidates ?? null);
    if (!item.imageCandidates?.length)
      void itemPictureChoices({ itemId: item.id })
        .then(setChoices)
        .catch(() => setChoices([]));
  };
  const approve = async () => {
    s.upsertItem({ ...item, imageCheck: false });
    await approvePictures({ itemIds: [item.id] }).catch(() => toast.error(t.errors.generic));
  };

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div className="relative">
        <ProductImage
          key={item.imageUrl ?? "none"}
          src={item.imageUrl}
          alt={item.title}
          className={cn("size-24 rounded-[var(--radius-tile)] ring-1 ring-line sm:size-28", popped && "animate-pop-in", item.imageCheck && "ring-2 ring-tint-ink/60")}
          data-sheet-img
        />
        <button
          type="button"
          onClick={openPicker}
          className="absolute -bottom-1.5 -end-1.5 grid size-9 place-items-center rounded-full border border-line bg-surface text-ink shadow-card transition hover:bg-surface-2 active:scale-95"
          aria-label={t.pictures.change}
          title={t.pictures.change}
          data-change-picture
        >
          <ImagePlus className="size-4" />
        </button>
      </div>
      {item.imageCheck && item.imageUrl && (
        <button type="button" onClick={() => void approve()} className="inline-flex h-8 items-center gap-1 rounded-full bg-tint px-2.5 text-[11.5px] font-bold text-tint-ink" title={t.pictures.check} data-picture-approve>
          <Check className="size-3.5" strokeWidth={3} /> {t.pictures.looksRight}
        </button>
      )}
      {open && (
        <PicturePicker
          open
          onOpenChange={setOpen}
          title={item.title}
          current={item.imageUrl}
          candidates={choices ?? []}
          loading={choices == null}
          keyword={item.productInfo?.iconKeyword ?? item.title.split(" ")[0] ?? "package"}
          onPick={async (c) => {
            const updated = await setItemPicture({ itemId: item.id, url: c.url, source: c.source }).catch(() => null);
            if (updated) {
              setPopped(true);
              s.upsertItem(updated);
            }
            else toast.error(t.errors.generic);
          }}
        />
      )}
    </div>
  );
}
