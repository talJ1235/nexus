// R19 C3 — how much of the homes' lists the rules map (no AI): runs C1 on every space's supermarket rows of a DB and
// prints the shares. On a copy only (it writes items.catalog_gtin / match_state):
//   TURSO_DATABASE_URL=file:copy.db npx tsx --conditions=react-server scripts/prices/map-report.ts
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { systemSpaces } from "@/lib/db-scoped/system";
import { Scoped } from "@/lib/db-scoped";
import { mapRows, mapStores } from "@/lib/db-scoped/prices";
import { usualBrandFor } from "@/lib/db-scoped/brands";

async function main() {
  const spaces = (await systemSpaces()).map((x) => ({ id: x.id, owner: x.ownerId }));
  let tried = 0, auto = 0, ask = 0, none = 0, stores = 0;
  for (const sp of spaces) {
    const s = new Scoped({ spaceId: sp.id, userId: sp.owner, by: "system" });
    stores += await mapStores(s);
    for (;;) {
      const r = await mapRows(s, 200, (t) => usualBrandFor(s, t).then((u) => u?.brand ?? null));
      tried += r.tried; auto += r.auto; ask += r.ask; none += r.none;
      if (r.tried < 200) break;
    }
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.items).where(sql`list = 'supermarket' AND status = 'to_buy'`);
  const pct = (x: number) => (tried ? `${Math.round((x / tried) * 100)} %` : "—");
  console.log(`OK map-report: ${tried} rows of ${n} open · mapped ${auto} (${pct(auto)}) · ask ${ask} (${pct(ask)}) · nothing in the catalog ${none} (${pct(none)}) · stores mapped to a branch ${stores}`);
}
main().then(() => process.exit(0), (e) => (console.error(e), process.exit(1)));
