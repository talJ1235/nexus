import "server-only";
import { and, eq, isNotNull, ne, or, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { storeThumbnail } from "./images";
import { pictureSettled, pictureStyleOf } from "./picture-url";

/**
 * Round 11 D1 backfill: pictures stored before the one-catalogue look are re-normalized (trim, cut-out on a white
 * square or a square photo crop) in bounded batches — from the daily cron, and `scripts/backfill-pictures.ts` once.
 * Needs Blob storage (BLOB_READ_WRITE_TOKEN); without it there's nothing to write to and it does nothing.
 * Pictures that can't be fetched any more are skipped this run and retried on later runs.
 */
export async function normalizeOldPictures(budgetMs = 10_000, max = 30) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { tried: 0, done: 0, left: null as number | null, skipped: "no-blob" as const };
  const t0 = Date.now();
  const rows = await db
    .select({ id: schema.items.id, url: schema.items.imageUrl })
    .from(schema.items)
    .where(and(isNotNull(schema.items.imageUrl), or(isNull(schema.items.imageSource), ne(schema.items.imageSource, "icon"))));
  const todo = rows.filter((r) => !pictureSettled(r.url));
  let tried = 0;
  let done = 0;
  for (const r of todo.slice(0, max)) {
    if (Date.now() - t0 > budgetMs) break;
    tried++;
    const url = await storeThumbnail(r.url, r.id).catch(() => null);
    if (!url || !pictureStyleOf(url)) continue;
    await db.update(schema.items).set({ imageUrl: url }).where(eq(schema.items.id, r.id));
    done++;
  }
  return { tried, done, left: todo.length - done };
}
