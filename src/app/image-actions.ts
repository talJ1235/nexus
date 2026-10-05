"use server";

import { z } from "zod";
import { requireCtx } from "@/lib/ctx";
import { scoped } from "@/lib/db-scoped";
import { getItem } from "@/lib/data";
import { ensureItemImage } from "@/lib/product-image";
import type { ItemWithSources } from "@/lib/types";

/** Find pictures for image-less items (after a receipt, a barcode add, a manual item). Returns the updated items. */
export async function ensureImages(ids: string[]): Promise<ItemWithSources[]> {
  const s = scoped(await requireCtx("edit"));
  const list = z.array(z.string().min(1).max(40)).max(30).parse(ids);
  const t0 = Date.now();
  const out: ItemWithSources[] = [];
  // A few at a time, inside the function's time limit.
  for (let i = 0; i < list.length && Date.now() - t0 < 40_000; i += 3) {
    const batch = list.slice(i, i + 3);
    await Promise.all(batch.map((id) => ensureItemImage(s, id).catch(() => false)));
    for (const id of batch) {
      const it = await getItem(s, id);
      if (it) out.push(it);
    }
  }
  return out;
}

