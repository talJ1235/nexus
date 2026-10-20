// R19 B4 — picture coverage for the products a list shows: each open supermarket row's product (or, unmatched, its top
// 3 candidates at the home's store) goes through the catalog picture search; prints how many have a real photo and from
// where. On a copy only (writes catalog.image_*); unset BLOB_READ_WRITE_TOKEN to keep the source URLs (no upload).
//   TURSO_DATABASE_URL=file:copy.db npx tsx --env-file=.env.local --conditions=react-server scripts/prices/picture-report.ts
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Scoped } from "@/lib/db-scoped";
import { catalogSearch, fillCatalogPictures, priceStoreOf } from "@/lib/db-scoped/prices";
import { systemSpaces } from "@/lib/db-scoped/system";
import { typeOf, classifyLocal } from "@/lib/grocery/classify";

async function main() {
  const want = new Set<string>();
  for (const sp of await systemSpaces()) {
    const s = new Scoped({ spaceId: sp.id, userId: sp.ownerId, by: "system" });
    const at = await priceStoreOf(s);
    const rows = await s.pick({ title: schema.items.title, gtin: schema.items.catalogGtin }, schema.items, sql`list = 'supermarket' AND status = 'to_buy'`);
    for (const r of rows) {
      if (r.gtin) want.add(r.gtin);
      else {
        const q = /[֐-׿]/.test(r.title) ? r.title : (typeOf(classifyLocal(r.title).type)?.he ?? r.title);
        for (const h of (await catalogSearch(q, at, { limit: 3 })).slice(0, 3)) want.add(h.gtin);
      }
    }
  }
  const gtins = [...want];
  const t0 = Date.now();
  for (let i = 0; i < gtins.length; i += 8) await fillCatalogPictures(gtins.slice(i, i + 8), { budgetMs: 40_000 }).catch((e) => console.log("batch failed", String(e).slice(0, 120)));
  const rows = gtins.length ? await db.select({ gtin: schema.catalog.gtin, name: schema.catalog.name, url: schema.catalog.imageUrl, src: schema.catalog.imageSrc }).from(schema.catalog).where(sql`gtin IN (${sql.join(gtins.map((g) => sql`${g}`), sql`, `)})`) : [];
  const got = rows.filter((r) => r.url);
  const by: Record<string, number> = {};
  for (const r of got) by[r.src ?? "?"] = (by[r.src ?? "?"] ?? 0) + 1;
  for (const r of rows) console.log(`${r.url ? "PIC " : "NONE"} ${r.src ?? "-"} ${r.name.slice(0, 50)}`);
  console.log(`OK picture-report: ${got.length} of ${rows.length} products with a real photo (${rows.length ? Math.round((got.length / rows.length) * 100) : 0} %) · ${JSON.stringify(by)} · ${Math.round((Date.now() - t0) / 1000)} s`);
}
main().then(() => process.exit(0), (e) => (console.error(e), process.exit(1)));
