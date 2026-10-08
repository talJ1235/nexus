import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { schema } from "@/db";
import { generateJson } from "@/lib/ai";
import { aiSystem } from "@/lib/ai-gate";
import { LONG_TITLE, pickShortName, SHORT_MAX } from "@/lib/short-name";
import type { Scoped } from "./index";

// R17 B1 backfill (daily cron, per space): items whose title is still the store's long title get a short name, the
// original kept in full_title. Never an item the person renamed: only items whose title still equals what the store
// link read (sources.raw_title, without AliExpress's suffix) — anything else is skipped. The AI's names come out of the
// system budget (`aiBudget.left`, shared across spaces; never anyone's quota); past it, the rest wait for the next run.

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s*(?:-\s*)?AliExpress(\s*\d+)?\s*$/i, "").replace(/\s+/g, " ").trim().toLowerCase();

/** The AI's short name for one title (system budget). */
export async function aiShortName(title: string, store: string | null, spaceId: string): Promise<{ name: string; qty: number | null } | null> {
  const out = await generateJson<{ name: string; qty: number | null }>(
    `Give this store product title a short name, at most ${SHORT_MAX} characters, the way a person would write it on their own shopping list: what it is, plus brand/model if present. Same language as the title (Hebrew stays Hebrew). Drop store names, marketing words, colour lists and repeats. If the title starts with a pack count ("Two Pieces", "10Pcs", "Set of 3"), return that number as qty, else null.\nTitle: ${title}${store ? `\nStore: ${store}` : ""}`,
    { type: "object", properties: { name: { type: "string" }, qty: { type: ["integer", "null"] } }, required: ["name", "qty"] },
    { use: aiSystem("short_name", spaceId), budgetMs: 8_000 },
  ).catch(() => null);
  return out?.name ? out : null;
}

export async function backfillShortNames(s: Scoped, aiBudget: { left: number }, max = 20, ai = aiShortName) {
  const rows = await s
    .select(schema.items, and(isNull(schema.items.fullTitle), sql`length(${schema.items.title}) > ${LONG_TITLE}`))
    .orderBy(asc(schema.items.createdAt))
    .limit(max);
  let changed = 0;
  let skipped = 0;
  let viaAi = 0;
  for (const it of rows) {
    const [src] = await s.select(schema.sources, eq(schema.sources.itemId, it.id)).orderBy(asc(schema.sources.createdAt)).limit(1);
    // Renamed (or no store read to compare with) → leave it alone.
    if (!src?.rawTitle || norm(src.rawTitle) !== norm(it.title)) {
      skipped++;
      continue;
    }
    if (aiBudget.left <= 0) break; // the rest wait for tomorrow's run
    aiBudget.left--;
    const fromAi = await ai(it.title, src.store, s.spaceId);
    if (fromAi) viaAi++;
    const short = pickShortName(it.title, fromAi?.name, src.store);
    const qty = fromAi?.qty ?? short.qty;
    if (!short.name || short.name === it.title) {
      skipped++;
      continue;
    }
    await s.update(schema.items, { title: short.name, fullTitle: it.title, ...(qty && qty > 1 && it.quantity === 1 ? { quantity: qty } : {}), updatedAt: Date.now() }, eq(schema.items.id, it.id));
    changed++;
  }
  return { changed, skipped, viaAi };
}
