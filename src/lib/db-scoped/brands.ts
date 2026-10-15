import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { schema } from "@/db";
import { brandOf, classifyLocal } from "@/lib/grocery/classify";
import { usualOf, type UsualBrand } from "@/lib/grocery/brands";

export type { UsualBrand };
import { forgetOf, type Forget } from "./grocery";
import type { Scoped } from "./index";

// R18 S3 C6 — the usual brand per product type in this home: each buy's brand (`brandOf` of the product's name) from a
// barcode add, a store-mode check of a barcoded row (when the trip ends) and the lines of an applied receipt. Shown when
// the type was bought ≥ 3 times and one brand is ≥ 60 % of it; read after the forget cut-offs (`all`, `b:<type>`).

const cutFor = (f: Forget, type: string) => Math.max(f.all ?? 0, f[`b:${type}`] ?? 0);

/** One buy's brand (nothing when the name has no brand, or its type is unknown). A known `id` is a no-op (resends). */
export async function recordBrand(s: Scoped, o: { title: string; source: "scan" | "check" | "receipt"; id?: string; ref?: string | null; by?: string | null; at?: number }) {
  const b = brandOf(o.title);
  if (!b) return false;
  const id = o.id ?? `bb_${nanoid(12)}`;
  if (o.id && (await s.byId(schema.brandBuy, id))) return false;
  await s.insert(schema.brandBuy, { id, type: b.type, brand: b.brand.slice(0, 80), brandKey: b.key.slice(0, 80), source: o.source, ref: o.ref ?? null, byUser: o.by ?? null, at: o.at ?? Date.now() });
  return true;
}

/** An undone receipt takes its brands back. */
export async function dropBrands(s: Scoped, ref: string) {
  await s.delete(schema.brandBuy, eq(schema.brandBuy.ref, ref));
}

/** A finished trip: every row that ended checked and carries a barcode counts once (re-running is a no-op). */
export async function recordTripBrands(s: Scoped, tripId: string, by: string | null) {
  const checks = (await s.select(schema.tripCheck, eq(schema.tripCheck.tripId, tripId))).sort((a, b) => a.seq - b.seq);
  // The row's last word: checked (not a substitute — that's another product, not found, or unchecked again).
  const last = new Map<string, string>();
  const barcoded = new Map<string, number>();
  for (const c of checks) {
    if (!c.itemId) continue;
    if (c.action === "check" || c.action === "uncheck" || c.action === "not_found" || c.action === "substitute") last.set(c.itemId, c.action);
    if (c.gtin) barcoded.set(c.itemId, c.at);
  }
  const ids = [...barcoded.keys()].filter((id) => last.get(id) === "check");
  if (!ids.length) return 0;
  const rows = await s.pick({ id: schema.items.id, title: schema.items.title }, schema.items, inArray(schema.items.id, ids));
  let n = 0;
  for (const r of rows) if (await recordBrand(s, { id: `bb_t_${tripId}_${r.id}`, title: r.title, source: "check", ref: tripId, by, at: barcoded.get(r.id) })) n++;
  return n;
}

/** The usual brand for a product (by its name's type), or null. */
export async function usualBrandFor(s: Scoped, title: string): Promise<UsualBrand | null> {
  const type = classifyLocal(title).type;
  if (!type) return null;
  const [rows, f] = await Promise.all([s.pick({ type: schema.brandBuy.type, brand: schema.brandBuy.brand, brandKey: schema.brandBuy.brandKey, at: schema.brandBuy.at }, schema.brandBuy, and(eq(schema.brandBuy.type, type))), forgetOf(s)]);
  return usualOf(rows, cutFor(f, type));
}

/** Every type with a usual brand (What Nexus learned). */
export async function usualBrands(s: Scoped): Promise<Map<string, UsualBrand>> {
  const [rows, f] = await Promise.all([s.pick({ type: schema.brandBuy.type, brand: schema.brandBuy.brand, brandKey: schema.brandBuy.brandKey, at: schema.brandBuy.at }, schema.brandBuy), forgetOf(s)]);
  const byType = new Map<string, { type: string; brand: string; brandKey: string; at: number }[]>();
  for (const r of rows) byType.set(r.type, [...(byType.get(r.type) ?? []), r]);
  const out = new Map<string, UsualBrand>();
  for (const [type, list] of byType) {
    const u = usualOf(list, cutFor(f, type));
    if (u) out.set(type, u);
  }
  return out;
}
