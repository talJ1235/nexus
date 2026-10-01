"use server";

import { z } from "zod";
import { assertOwner } from "@/lib/auth";
import { getItem } from "@/lib/data";
import { ensureItemImage, findImage } from "@/lib/product-image";
import type { ItemWithSources } from "@/lib/types";

/** Find pictures for image-less items (after a receipt, a barcode add, a manual item). Returns the updated items. */
export async function ensureImages(ids: string[]): Promise<ItemWithSources[]> {
  await assertOwner();
  const list = z.array(z.string().min(1).max(40)).max(30).parse(ids);
  const t0 = Date.now();
  const out: ItemWithSources[] = [];
  // A few at a time, inside the function's time limit.
  for (let i = 0; i < list.length && Date.now() - t0 < 40_000; i += 3) {
    const batch = list.slice(i, i + 3);
    await Promise.all(batch.map((id) => ensureItemImage(id).catch(() => false)));
    for (const id of batch) {
      const it = await getItem(id);
      if (it) out.push(it);
    }
  }
  return out;
}

/** Pictures for receipt lines that will become new items (review screen); nothing is saved. */
export async function previewImages(input: { names: string[] }): Promise<(string | null)[]> {
  await assertOwner();
  const { names } = z.object({ names: z.array(z.string().min(1).max(300)).max(40) }).parse(input);
  const t0 = Date.now();
  const out: (string | null)[] = names.map(() => null);
  for (let i = 0; i < names.length && Date.now() - t0 < 25_000; i += 4) {
    const res = await Promise.all(names.slice(i, i + 4).map((title) => findImage({ title }).catch(() => null)));
    res.forEach((r, k) => (out[i + k] = r?.url ?? null));
  }
  return out;
}
