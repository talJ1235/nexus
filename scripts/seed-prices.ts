// R19 — price data for local / smoke servers (the real ingestion over the trimmed real files in scripts/fixtures/prices):
// branches of five chains (Rami Levy, Shufersal, King Store, City Market, Yochananof) + the demo list's products priced
// at Shufersal and Rami Levy with a few deals (scripts/lib/demo-prices.ts, synthetic).
//   TURSO_DATABASE_URL=file:smoke.db npx tsx scripts/seed-prices.ts
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { writeFileSync } from "node:fs";
import { ingestDump } from "../src/lib/prices/ingest";
import { demoPriceFull, demoPromoFull } from "./lib/demo-prices";

const FIX = "scripts/fixtures/prices";
const files: [string, string, string][] = [
  ["RAMI_LEVY", "stores-cerberus-utf16.xml", "Stores7290058140886-000-20261019-050501.xml"],
  ["SHUFERSAL", "stores-shufersal.xml", "Stores7290027600007-000-20261019-020100.xml"],
  ["KING_STORE", "stores-bina.xml", "Stores7290058108879-000-20261019-045059.xml"],
  ["CITY_MARKET_SHOPS", "stores-citymarket.xml", "StoresFull7290000000003-000-202610191100.xml"],
  ["YOHANANOF", "stores-yohananof.xml", "Stores7290803800003-000-20261017-010000.xml"],
];

async function main() {
  const dump = mkdtempSync(join(tmpdir(), "nexus-seed-prices-"));
  for (const [chain, src, name] of files) {
    mkdirSync(join(dump, chain), { recursive: true });
    copyFileSync(join(FIX, src), join(dump, chain, name));
  }
  const now = new Date();
  const stamp = `${now.toISOString().slice(0, 10).replace(/-/g, "")}-${now.toISOString().slice(11, 16).replace(":", "")}00`;
  for (const [chain, gov] of [["SHUFERSAL", "7290027600007"], ["RAMI_LEVY", "7290058140886"]] as const) {
    mkdirSync(join(dump, chain), { recursive: true });
    writeFileSync(join(dump, chain, `PriceFull${gov}-001-001-${stamp}.xml`), demoPriceFull(chain, now));
    writeFileSync(join(dump, chain, `PromoFull${gov}-001-001-${stamp}.xml`), demoPromoFull(chain, now));
  }
  const db = createClient({ url: process.env.TURSO_DATABASE_URL ?? "file:local.db", authToken: process.env.TURSO_AUTH_TOKEN });
  const r = await ingestDump(db, dump, { now: Date.now() });
  console.log(`OK seed-prices: ${r.chains.map((c) => `${c.id} ${c.branches}`).join(", ")} · ${r.writes} rows`);
  db.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
