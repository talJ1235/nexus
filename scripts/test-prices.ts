// R19 B1–B2 — the price-transparency files: Stores in four portal layouts (Cerberus UTF-16 with a BOM, Bina, Shufersal's
// one-line UTF-8 with a BOM, City Market's nested XMLObjects; a chain without city codes), full + partial price files
// (weighted items, store codes), full + partial promo files (a club deal), the file names of each portal; then the
// ingestion into a scratch DB: chains, branches, chain prices, a branch's own prices, deals, catalog, and only changes
// written on a second run. npm run test:prices
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { CHAINS } from "../src/lib/grocery/chains";
import { dealOf } from "../src/lib/prices/deals";
import { isStale } from "../src/lib/prices/health";
import { ingestDump, planStores } from "../src/lib/prices/ingest";
import { decodeXml, fileInfo, parsePrices, parsePromos, parseStores } from "../src/lib/prices/parse";

const FIX = "scripts/fixtures/prices";
const read = (f: string) => decodeXml(readFileSync(join(FIX, f)));

// ---- Stores: four layouts.
const cer = parseStores(read("stores-cerberus-utf16.xml"));
assert.equal(cer.chainId, "7290058140886");
assert.equal(cer.chainName, "רמי לוי שיווק השקמה", "UTF-16 LE with a BOM decodes");
assert.equal(cer.stores.length, 4);
assert.deepEqual([cer.stores[0].storeId, cer.stores[0].name, cer.stores[0].city.he, cer.stores[0].city.en], [1, "תלפיות", "ירושלים", "Jerusalem"]);
const bina = parseStores(read("stores-bina.xml"));
assert.equal(bina.stores.length, 3);
assert.equal(bina.stores[0].city.code, 2710);
const shu = parseStores(read("stores-shufersal.xml"));
assert.equal(shu.chainId, "7290027600007");
assert.equal(shu.stores.length, 4);
assert.equal(shu.stores[0].subChainName, "שופרסל שלי", "the sub-chain's name reaches its stores");
const city = parseStores(read("stores-citymarket.xml"));
assert.equal(city.stores.length, 3, "City Market's nested store objects");
assert.ok(city.stores.every((s) => s.address === ""), "'unknown' addresses are empty");
const yoh = parseStores(read("stores-yohananof.xml"));
assert.ok(yoh.stores.length === 3 && yoh.stores.some((s) => s.city.he), "a city guessed from the store's name / address when the code is missing");

// ---- Prices.
const full = parsePrices(read("pricefull-cerberus-a.xml"));
assert.equal(full.storeId, 1);
assert.equal(full.items.length, 5);
assert.ok(full.items.every((i) => /^\d{13}$/.test(i.code) && !i.internal && i.price > 0));
const w = parsePrices(read("pricefull-cerberus-w.xml"));
assert.ok(w.items.length === 2 && w.items.every((i) => i.weighted), "weighted items");
const part = parsePrices(read("price-cerberus.xml"));
assert.ok(part.items.length === 3 && part.items.some((i) => i.internal), "a partial file with store codes");
const bp = parsePrices(read("pricefull-bina.xml"));
assert.equal(bp.items.length, 4);
assert.ok(bp.items.some((i) => i.weighted && i.unit), "Bina weighted row with its unit");

// ---- Promotions.
const pf = parsePromos(read("promofull-cerberus.xml"));
assert.equal(pf.promos.length, 3);
assert.ok(pf.promos.every((p) => p.id && p.description && p.items.length > 0));
const pb = parsePromos(read("promofull-bina.xml"));
assert.ok(pb.promos.length === 2 && pb.promos.every((p) => p.club), "a club-only deal (named club list)");
const pp = parsePromos(read("promo-cerberus.xml"));
assert.equal(pp.promos.length, 2);
assert.equal(dealOf(pf.promos[0]).kind, "price");

// ---- File names of each portal.
assert.deepEqual(fileInfo("Price7290027600007-001-001-20261019-160000.gz"), { kind: "Price", chainId: "7290027600007", storeId: 1, stamp: "202610191600" });
assert.deepEqual(fileInfo("PriceFull7290058108879-000-340-20261019-045059.xml"), { kind: "PriceFull", chainId: "7290058108879", storeId: 340, stamp: "202610190450" });
assert.deepEqual(fileInfo("price7290058140886-039-202607151000.xml"), { kind: "Price", chainId: "7290058140886", storeId: 39, stamp: "202607151000" });
assert.equal(fileInfo("StoresFull7290000000003-000-202610191100.xml")?.kind, "Stores");
assert.equal(fileInfo("PromoFull7290058140886-001-001-20261020-001114.xml")?.kind, "PromoFull");

// ---- B5: stale after 26 h without a file.
assert.ok(!isStale(Date.now() - 25 * 3_600_000) && isStale(Date.now() - 27 * 3_600_000) && isStale(null));

// ---- Every chain in the registry has a scraper name.
for (const c of CHAINS) assert.ok(c.scraper, `${c.id} has a scraper`);
// A10: the big chains (the picker's first grid) have their real logo file; the list the app reads matches the files.
const logos: string[] = JSON.parse(readFileSync("src/lib/grocery/chain-logos.json", "utf8"));
for (const c of CHAINS.filter((x) => x.big)) assert.ok(logos.includes(c.id), `${c.id} has a logo`);
for (const id of logos) assert.ok(existsSync(join("public/chains", `${id}.webp`)), `public/chains/${id}.webp`);

void (async () => {
// ---- Ingestion into a scratch DB.
const tmp = mkdtempSync(join(tmpdir(), "nexus-prices-"));
const dbFile = join(tmp, "p.db");
execSync("npx tsx src/db/migrate.ts", { env: { ...process.env, TURSO_DATABASE_URL: `file:${dbFile}` }, stdio: "ignore" });
const db = createClient({ url: `file:${dbFile}` });
const dump = join(tmp, "dump");
const rl = join(dump, "RAMI_LEVY");
mkdirSync(rl, { recursive: true });
copyFileSync(join(FIX, "stores-cerberus-utf16.xml"), join(rl, "Stores7290058140886-000-20261019-050501.xml"));
copyFileSync(join(FIX, "pricefull-cerberus-a.xml"), join(rl, "PriceFull7290058140886-001-001-20261019-030000.xml"));
copyFileSync(join(FIX, "pricefull-cerberus-w.xml"), join(rl, "PriceFull7290058140886-001-002-20261019-030000.xml"));
copyFileSync(join(FIX, "promofull-cerberus.xml"), join(rl, "PromoFull7290058140886-001-001-20261019-030000.xml"));
const now = Date.parse("2026-10-19T09:00:00+03:00");
const r1 = await ingestDump(db, dump, { now });
const one = async (sql: string) => Number((await db.execute(sql)).rows[0].n);
const c1 = r1.chains[0];
assert.equal(c1.id, "rami-levy");
assert.equal(c1.branches, 4);
assert.equal(await one("SELECT count(*) n FROM branch WHERE chain_id = 'rami-levy'"), 4);
assert.equal((await db.execute("SELECT gov_id FROM chain WHERE id = 'rami-levy'")).rows[0].gov_id, "7290058140886");
assert.equal(c1.chainPrices.new, 7, "5 + 2 products, one price each");
assert.equal(await one("SELECT count(*) n FROM chain_price"), 7);
assert.equal(await one("SELECT count(*) n FROM price_day"), 7);
assert.equal(await one("SELECT count(*) n FROM catalog"), 7);
assert.ok((await one("SELECT count(*) n FROM catalog WHERE weighted = 1")) >= 2);
assert.ok((await one("SELECT count(*) n FROM promo")) >= 2, "deals still running are kept");
assert.ok((await one("SELECT count(*) n FROM branch_price")) > 0, "the representative branch keeps its own prices");
assert.ok((await one("SELECT count(*) n FROM price_file")) === 4);
// Same files again: nothing new to read, no price rows written.
const r2 = await ingestDump(db, dump, { now: now + 3600_000 });
assert.equal(r2.chains[0].chainPrices.new + r2.chains[0].chainPrices.changed, 0);
assert.ok(r2.writes < 5, `second run writes only the chain's status (${r2.writes})`);
// A partial file for the representative branch (store 1) moves its price — current, not this morning's.
const rep = Number((await db.execute("SELECT rep_store n FROM chain WHERE id = 'rami-levy'")).rows[0].n);
const gtin = String((await db.execute(`SELECT gtin FROM branch_price WHERE branch_id = 'rami-levy:${rep}' LIMIT 1`)).rows[0].gtin);
const src = ["pricefull-cerberus-a.xml", "pricefull-cerberus-w.xml"].map((f) => decodeXml(readFileSync(join(FIX, f)))).find((x) => x.includes(`<ItemCode>${gtin}</ItemCode>`))!;
const moved = src.replace(new RegExp(String.raw`(<ItemCode>${gtin}</ItemCode>[\s\S]*?<ItemPrice>)[\d.]+(</ItemPrice>)`), "$1" + "1.23$2");
writeFileSync(join(rl, `Price7290058140886-001-${String(rep).padStart(3, "0")}-20261019-120000.xml`), moved, "utf8");
const r3 = await ingestDump(db, dump, { now: now + 4 * 3600_000 });
assert.ok(r3.chains[0].branchPrices >= 1);
assert.equal(Number((await db.execute(`SELECT price FROM branch_price WHERE branch_id = 'rami-levy:${rep}' AND gtin = '${gtin}'`)).rows[0].price), 1.23);
assert.equal(Number((await db.execute(`SELECT price FROM chain_price WHERE chain_id = 'rami-levy' AND gtin = '${gtin}'`)).rows[0].price), 1.23, "the representative's partial file moves the chain's price");
const plan = await planStores(db, 3);
assert.ok(plan.RAMI_LEVY?.includes(rep), "the plan downloads the representative");
// Dry run: reads and counts, writes nothing.
const before = await one("SELECT count(*) n FROM price_file");
const dry = await ingestDump(db, dump, { dry: true, now: now + 5 * 3600_000 });
assert.ok(dry.chains.length === 1 && (await one("SELECT count(*) n FROM price_file")) === before);
db.close();
try {
  rmSync(tmp, { recursive: true, force: true });
} catch {}
console.log(`OK test:prices (4 Stores layouts, full + partial prices, promos, file names, ingest: ${r1.writes} writes first run, ${r2.writes} the second)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
