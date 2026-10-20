// R19 B1–B3 — a folder of downloaded transparency files (scripts/prices/fetch.py: one folder per scraper name) → the
// price tables, writing only what changed: chains + branches (Stores), each chain's current price per product (the most
// common across the branches read) + a branch's own prices for the branches people use and the chain's representative,
// a price_day point when a chain's price changes, deals (Promo), the catalog (B3), and the file log (B5). Partial files
// (Price / Promo, during the day) update the branches they're for. `dry` = read + count, write nothing.
// Node only (fs); used by scripts/prices/ingest.mts and test:prices.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Client, InStatement } from "@libsql/client";
import { CHAINS, chainByScraper } from "../grocery/chains";
import { normalize } from "../grocery/normalize";
import { chainPriceOf, isRealGtin, mergeProduct, type CatalogEntry } from "./catalog";
import { dealOf } from "./deals";
import { decodeXml, fileInfo, parsePrices, parsePromos, parseStores, type PriceRow, type PromoRow } from "./parse";

type Kind = "Stores" | "PriceFull" | "Price" | "PromoFull" | "Promo";
export type FileRef = { path: string; name: string; kind: Kind; storeId: number | null; stamp: string; at: number };
export type IngestReport = {
  chains: { id: string; files: Record<string, number>; branches: number; products: number; chainPrices: { new: number; changed: number }; branchPrices: number; promos: number; ms: number; error?: string }[];
  catalog: { new: number; changed: number; total: number };
  writes: number;
  reads: number;
  ms: number;
};

/** "202610191600" (Israel local time in file names) → epoch ms. */
export const stampAt = (stamp: string) => Date.parse(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10) || "00"}:${stamp.slice(10, 12) || "00"}:00+03:00`);
const isoAt = (iso: string | null) => (iso ? Date.parse(`${iso}+03:00`) || null : null);
const dayOf = (ms: number) => new Date(ms + 3 * 3600_000).toISOString().slice(0, 10);

/** The files of one scraper folder, newest first per (kind, store). */
export function listDump(dir: string): Map<string, FileRef[]> {
  const out = new Map<string, FileRef[]>();
  for (const scraper of readdirSync(dir)) {
    const sub = join(dir, scraper);
    if (!statSync(sub).isDirectory() || !chainByScraper(scraper)) continue;
    const files: FileRef[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) {
          if (!/status/i.test(f)) walk(p);
          continue;
        }
        if (!/\.(xml|gz)$/i.test(f)) continue;
        const info = fileInfo(f);
        if (!info) continue;
        files.push({ path: p, name: f.replace(/\.(xml|gz)$/i, ""), kind: info.kind, storeId: info.storeId, stamp: info.stamp, at: stampAt(info.stamp) });
      }
    };
    walk(sub);
    files.sort((a, b) => b.at - a.at);
    out.set(scraper, files);
  }
  return out;
}

const readXml = (p: string) => {
  let buf: Uint8Array = readFileSync(p);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  return decodeXml(buf);
};

/** Writes in batches; counts them (the Turso quota is rows written). */
class Writer {
  private q: InStatement[] = [];
  writes = 0;
  constructor(
    private db: Client,
    private dry: boolean,
  ) {}
  add(s: InStatement) {
    this.writes++;
    if (this.dry) return;
    this.q.push(s);
  }
  async flush(force = false) {
    if (this.dry) return;
    while (this.q.length >= (force ? 1 : 400)) await this.db.batch(this.q.splice(0, 400), "write");
  }
}

export async function ingestDump(db: Client, dir: string, opts: { dry?: boolean; now?: number; log?: (s: string) => void } = {}): Promise<IngestReport> {
  const t0 = performance.now();
  const now = opts.now ?? Date.now();
  const log = opts.log ?? (() => {});
  const w = new Writer(db, !!opts.dry);
  let reads = 0;
  const q = async (sql: string, args: (string | number | null)[] = []) => {
    const r = await db.execute({ sql, args });
    reads += r.rows.length;
    return r.rows;
  };
  const report: IngestReport = { chains: [], catalog: { new: 0, changed: 0, total: 0 }, writes: 0, reads: 0, ms: 0 };
  // Branches whose own prices are kept: the ones a space chose + each chain's representative.
  const picked = new Set((await q("SELECT DISTINCT branch_id FROM space_store WHERE branch_id IS NOT NULL").catch(() => [])).map((r) => String(r.branch_id)));
  const productRows = new Map<string, [string, PriceRow][]>();
  for (const [scraper, files] of listDump(dir)) {
    const meta = chainByScraper(scraper)!;
    const c0 = performance.now();
    const rep: IngestReport["chains"][number] = { id: meta.id, files: {}, branches: 0, products: 0, chainPrices: { new: 0, changed: 0 }, branchPrices: 0, promos: 0, ms: 0 };
    try {
      for (const f of files) rep.files[f.kind] = (rep.files[f.kind] ?? 0) + 1;
      const seen = new Set((await q("SELECT name FROM price_file WHERE chain_id = ?", [meta.id])).map((r) => String(r.name)));
      const fresh = files.filter((f) => !seen.has(f.name));
      const logFile = (f: FileRef, rows: number, changed: number, ms: number, error: string | null = null) =>
        w.add({ sql: "INSERT OR REPLACE INTO price_file (name, chain_id, store_id, kind, stamp, read_at, rows, changed, ms, error) VALUES (?,?,?,?,?,?,?,?,?,?)", args: [f.name, meta.id, f.storeId, f.kind, f.stamp, now, rows, changed, Math.round(ms), error] });

      // ---- Stores: the newest Stores file → chain + branches.
      let govId: string | null = (await q("SELECT gov_id FROM chain WHERE id = ?", [meta.id]))[0]?.gov_id as string | null;
      const storesFile = files.find((f) => f.kind === "Stores");
      if (storesFile && !seen.has(storesFile.name)) {
        const s0 = performance.now();
        const st = parseStores(readXml(storesFile.path));
        govId = st.chainId || govId;
        const old = new Map((await q("SELECT id, name, address, city, kind, sub_chain FROM branch WHERE chain_id = ?", [meta.id])).map((r) => [String(r.id), r]));
        let changed = 0;
        for (const b of st.stores) {
          const id = `${meta.id}:${b.storeId}`;
          const o = old.get(id);
          const city = b.city.he || b.city.en;
          if (o && o.name === b.name && o.address === b.address && o.city === city && Number(o.kind ?? 0) === (b.type ?? 0) && (o.sub_chain ?? null) === b.subChainId) continue;
          changed++;
          w.add({
            sql: `INSERT INTO branch (id, chain_id, store_id, sub_chain, name, address, city, city_en, city_code, zip, kind, lat, lng, search, updated_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(id) DO UPDATE SET sub_chain = excluded.sub_chain, name = excluded.name, address = excluded.address, city = excluded.city,
                    city_en = excluded.city_en, city_code = excluded.city_code, zip = excluded.zip, kind = excluded.kind,
                    lat = coalesce(excluded.lat, branch.lat), lng = coalesce(excluded.lng, branch.lng), search = excluded.search, updated_at = excluded.updated_at, gone_at = NULL`,
            args: [id, meta.id, b.storeId, b.subChainId, b.name, b.address, city, b.city.en, b.city.code, b.zip, b.type, b.lat, b.lng, normalize(`${meta.he} ${meta.en} ${b.name} ${city} ${b.city.en} ${b.address}`), now],
          });
        }
        // Branches no longer in the file: marked gone (kept for old spaces' stores).
        const now2 = new Set(st.stores.map((b) => `${meta.id}:${b.storeId}`));
        for (const id of old.keys()) if (!now2.has(id)) w.add({ sql: "UPDATE branch SET gone_at = coalesce(gone_at, ?) WHERE id = ?", args: [now, id] });
        rep.branches = st.stores.length;
        logFile(storesFile, st.stores.length, changed, performance.now() - s0);
        log(`${meta.id}: ${st.stores.length} branches (${changed} changed)`);
      }
      if (!govId) govId = files.map((f) => fileInfo(f.name)?.chainId).find(Boolean) ?? meta.id;
      w.add({
        sql: `INSERT INTO chain (id, gov_id, he, en, color, branches, last_file_at, last_ok_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET gov_id = excluded.gov_id, he = excluded.he, en = excluded.en, color = excluded.color,
                branches = CASE WHEN excluded.branches > 0 THEN excluded.branches ELSE chain.branches END,
                last_file_at = max(coalesce(chain.last_file_at, 0), coalesce(excluded.last_file_at, 0)), last_ok_at = excluded.last_ok_at, last_error = NULL, updated_at = excluded.updated_at`,
        args: [meta.id, govId, meta.he, meta.en, meta.color, rep.branches, files[0]?.at ?? null, now, now],
      });
      await w.flush();

      // ---- Prices: full files give the chain's price; partial files update the branches they're for.
      const fulls = latestPerStore(fresh.filter((f) => f.kind === "PriceFull"));
      const partials = fresh.filter((f) => f.kind === "Price").sort((a, b) => a.at - b.at);
      const repRow = (await q("SELECT rep_store FROM chain WHERE id = ?", [meta.id]))[0];
      let repStore = repRow?.rep_store != null ? Number(repRow.rep_store) : null;
      const byGtin = new Map<string, { prices: number[]; unit: number | null; at: number | null }>();
      const branchRows = new Map<string, Map<string, PriceRow>>();
      let most = -1;
      for (const f of fulls) {
        const p0 = performance.now();
        const pf = parsePrices(readXml(f.path));
        const store = pf.storeId ?? f.storeId;
        for (const it of pf.items) {
          const k = it.internal || !isRealGtin(it.code) ? `${meta.id}#${it.code}` : it.code;
          const e = byGtin.get(k) ?? { prices: [], unit: it.unitPrice, at: isoAt(it.updated) };
          e.prices.push(it.price);
          byGtin.set(k, e);
          const list = productRows.get(k) ?? [];
          if (list.length < 40) list.push([meta.id, it]);
          productRows.set(k, list);
        }
        if (store != null && pf.items.length > most) (most = pf.items.length), (repStore = fulls.length > 1 || repStore == null ? store : repStore);
        if (store != null) branchRows.set(`${meta.id}:${store}`, new Map(pf.items.map((i) => [i.internal || !isRealGtin(i.code) ? `${meta.id}#${i.code}` : i.code, i])));
        logFile(f, pf.items.length, 0, performance.now() - p0);
        await w.flush();
      }
      if (fulls.length) {
        const old = new Map((await q("SELECT gtin, price FROM chain_price WHERE chain_id = ?", [meta.id])).map((r) => [String(r.gtin), Number(r.price)]));
        const day = dayOf(now);
        for (const [gtin, e] of byGtin) {
          const { price, low, high } = chainPriceOf(e.prices);
          const was = old.get(gtin);
          if (was === price) continue;
          if (was == null) rep.chainPrices.new++;
          else rep.chainPrices.changed++;
          w.add({
            sql: `INSERT INTO chain_price (chain_id, gtin, price, low, high, branches, unit_price, price_at, seen_at) VALUES (?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(chain_id, gtin) DO UPDATE SET price = excluded.price, low = excluded.low, high = excluded.high, branches = excluded.branches,
                    unit_price = excluded.unit_price, price_at = excluded.price_at, seen_at = excluded.seen_at`,
            args: [meta.id, gtin, price, low, high, e.prices.length, e.unit, e.at, now],
          });
          w.add({ sql: "INSERT OR REPLACE INTO price_day (chain_id, gtin, day, price) VALUES (?,?,?,?)", args: [meta.id, gtin, day, price] });
          await w.flush();
        }
        rep.products = byGtin.size;
        if (repStore != null) w.add({ sql: "UPDATE chain SET rep_store = ? WHERE id = ?", args: [repStore, meta.id] });
      }
      // A branch's own prices: picked branches + the representative (full file first, then the day's partial files).
      const own = (id: string) => picked.has(id) || (repStore != null && id === `${meta.id}:${repStore}`);
      for (const [bid, rows] of branchRows) {
        if (!own(bid)) continue;
        rep.branchPrices += await writeBranch(bid, [...rows.values()], true);
      }
      for (const f of partials) {
        const bid = `${meta.id}:${f.storeId}`;
        if (!own(bid)) {
          logFile(f, 0, 0, 0);
          continue;
        }
        const p0 = performance.now();
        const pf = parsePrices(readXml(f.path));
        const n = await writeBranch(bid, pf.items, false);
        rep.branchPrices += n;
        logFile(f, pf.items.length, n, performance.now() - p0);
        // The representative's change moves the chain's price too ("current, not this morning's").
        if (repStore != null && bid === `${meta.id}:${repStore}`)
          for (const it of pf.items) {
            const k = it.internal || !isRealGtin(it.code) ? `${meta.id}#${it.code}` : it.code;
            w.add({ sql: "UPDATE chain_price SET price = ?, price_at = ?, seen_at = ? WHERE chain_id = ? AND gtin = ? AND price <> ?", args: [it.price, isoAt(it.updated), now, meta.id, k, it.price] });
          }
        await w.flush();
      }

      // ---- Promotions: full files per store, then partial ones; one row per promotion with the stores it runs in.
      const promoFiles = [...latestPerStore(fresh.filter((f) => f.kind === "PromoFull")), ...fresh.filter((f) => f.kind === "Promo")];
      if (promoFiles.length) {
        const all = new Map<string, { p: PromoRow; stores: Set<number> }>();
        let storesSeen = 0;
        for (const f of promoFiles) {
          const p0 = performance.now();
          const pf = parsePromos(readXml(f.path));
          const store = pf.storeId ?? f.storeId;
          if (store != null) storesSeen++;
          for (const p of pf.promos) {
            const e = all.get(p.id) ?? { p, stores: new Set<number>() };
            if (store != null) e.stores.add(store);
            if (p.items.length > e.p.items.length) e.p = { ...p };
            all.set(p.id, e);
          }
          logFile(f, pf.promos.length, 0, performance.now() - p0);
        }
        const old = new Map((await q("SELECT id, description, ends, items, stores FROM promo WHERE chain_id = ?", [meta.id])).map((r) => [String(r.id), r]));
        for (const [pid, { p, stores }] of all) {
          const id = `${meta.id}:${pid}`;
          const deal = dealOf(p);
          const ends = isoAt(p.end);
          if (ends != null && ends < now) continue;
          const storeList = stores.size >= Math.max(1, storesSeen) ? null : [...stores].sort((a, b) => a - b);
          const o = old.get(id);
          const items = p.items.filter((i) => i.code).map((i) => (isRealGtin(i.code) ? i.code : `${meta.id}#${i.code}`));
          const sameStores = (o?.stores ?? null) === (storeList ? JSON.stringify(storeList) : null);
          if (o && o.description === p.description && Number(o.ends ?? 0) === (ends ?? 0) && Number(o.items) === items.length && sameStores) continue;
          rep.promos++;
          w.add({
            sql: `INSERT OR REPLACE INTO promo (id, chain_id, promo_id, description, kind, min_qty, price, rate, club, min_basket, starts, ends, stores, items, updated_at, seen_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            args: [id, meta.id, pid, p.description, deal.kind, deal.n, deal.price, deal.rate, deal.club ? 1 : 0, deal.minBasket, isoAt(p.start), ends, storeList ? JSON.stringify(storeList) : null, items.length, isoAt(p.updated), now],
          });
          if (!o) for (const g of items.slice(0, 400)) w.add({ sql: "INSERT OR IGNORE INTO promo_item (promo_id, gtin) VALUES (?,?)", args: [id, g] });
          await w.flush();
        }
        // Ended deals go (they never apply again); their items with them.
        w.add({ sql: "DELETE FROM promo_item WHERE promo_id IN (SELECT id FROM promo WHERE chain_id = ? AND ends < ?)", args: [meta.id, now - 86_400_000] });
        w.add({ sql: "DELETE FROM promo WHERE chain_id = ? AND ends < ?", args: [meta.id, now - 86_400_000] });
      }
      // The newest price file read per branch → its "updated · HH:MM".
      const newest = new Map<number, number>();
      for (const f of fresh) if (f.storeId != null && f.kind !== "Stores") newest.set(f.storeId, Math.max(newest.get(f.storeId) ?? 0, f.at));
      for (const [store, at] of newest) w.add({ sql: "UPDATE branch SET prices_at = max(coalesce(prices_at, 0), ?) WHERE id = ?", args: [at, `${meta.id}:${store}`] });
      await w.flush(true);
    } catch (e) {
      rep.error = e instanceof Error ? e.message.slice(0, 200) : String(e);
      log(`${meta.id}: ${rep.error}`);
      if (!opts.dry) await db.execute({ sql: "UPDATE chain SET last_error = ? WHERE id = ?", args: [rep.error, meta.id] }).catch(() => {});
    }
    rep.ms = Math.round(performance.now() - c0);
    report.chains.push(rep);
  }

  // ---- Catalog (B3): every product seen, merged across the chains read.
  if (productRows.size) {
    const old = new Map<string, { name: string; brand: string | null; qty: number | null; unit: string | null; chains: number }>();
    const keys = [...productRows.keys()];
    for (let i = 0; i < keys.length; i += 500) {
      const part = keys.slice(i, i + 500);
      for (const r of await q(`SELECT gtin, name, brand, qty, unit, chains FROM catalog WHERE gtin IN (${part.map(() => "?").join(",")})`, part))
        old.set(String(r.gtin), { name: String(r.name), brand: (r.brand as string) ?? null, qty: r.qty == null ? null : Number(r.qty), unit: (r.unit as string) ?? null, chains: Number(r.chains) });
    }
    for (const [gtin, rows] of productRows) {
      const e: CatalogEntry = mergeProduct(gtin.includes("#") ? gtin.split("#")[1] : gtin, rows);
      const o = old.get(gtin);
      if (o && o.name === e.name && o.brand === e.brand && o.qty === e.qty && o.unit === e.unit && o.chains >= e.chains) continue;
      if (o) report.catalog.changed++;
      else report.catalog.new++;
      w.add({
        sql: `INSERT INTO catalog (gtin, name, brand, manufacturer, qty, unit, weighted, internal, section, search, chains, branches, seen_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(gtin) DO UPDATE SET name = excluded.name, brand = excluded.brand, manufacturer = excluded.manufacturer, qty = excluded.qty,
                unit = excluded.unit, weighted = excluded.weighted, section = coalesce(catalog.section, excluded.section), search = excluded.search,
                chains = max(catalog.chains, excluded.chains), branches = max(catalog.branches, excluded.branches), seen_at = excluded.seen_at, updated_at = excluded.updated_at`,
        args: [gtin, e.name, e.brand, e.manufacturer, e.qty, e.unit, e.weighted ? 1 : 0, e.internal ? 1 : 0, e.section, e.search, e.chains, e.branches, now, now],
      });
      await w.flush();
    }
    await w.flush(true);
    report.catalog.total = productRows.size;
  }
  report.writes = w.writes;
  report.reads = reads;
  report.ms = Math.round(performance.now() - t0);
  return report;

  async function writeBranch(bid: string, rows: PriceRow[], full: boolean) {
    const old = new Map((await q(`SELECT gtin, price FROM branch_price WHERE branch_id = ?`, [bid])).map((r) => [String(r.gtin), Number(r.price)]));
    const chainId = bid.split(":")[0];
    let n = 0;
    for (const it of rows) {
      const k = it.internal || !isRealGtin(it.code) ? `${chainId}#${it.code}` : it.code;
      if (old.get(k) === it.price) continue;
      n++;
      w.add({
        sql: `INSERT INTO branch_price (branch_id, gtin, price, unit_price, price_at, seen_at) VALUES (?,?,?,?,?,?)
              ON CONFLICT(branch_id, gtin) DO UPDATE SET price = excluded.price, unit_price = excluded.unit_price, price_at = excluded.price_at, seen_at = excluded.seen_at`,
        args: [bid, k, it.price, it.unitPrice, isoAt(it.updated), now],
      });
      await w.flush();
    }
    void full;
    return n;
  }
}

/** The newest file per store of one kind. */
function latestPerStore(files: FileRef[]) {
  const by = new Map<number | string, FileRef>();
  for (const f of files) {
    const k = f.storeId ?? f.name;
    const o = by.get(k);
    if (!o || f.at > o.at) by.set(k, f);
  }
  return [...by.values()];
}

/** Which stores to download prices for (the plan fetch.py reads): picked + the representative + a spread sample. */
export async function planStores(db: Client, sample = 12): Promise<Record<string, number[]>> {
  const plan: Record<string, number[]> = {};
  const picked = (await db.execute("SELECT DISTINCT branch_id FROM space_store WHERE branch_id IS NOT NULL").catch(() => ({ rows: [] }))).rows.map((r) => String(r.branch_id));
  for (const c of CHAINS) {
    if (!c.scraper) continue;
    const ids = new Set<number>();
    for (const b of picked) if (b.startsWith(`${c.id}:`)) ids.add(Number(b.split(":")[1]));
    const rep = (await db.execute({ sql: "SELECT rep_store FROM chain WHERE id = ?", args: [c.id] })).rows[0]?.rep_store;
    if (rep != null) ids.add(Number(rep));
    const all = (await db.execute({ sql: "SELECT store_id FROM branch WHERE chain_id = ? AND gone_at IS NULL AND (kind IS NULL OR kind <> 2) ORDER BY store_id", args: [c.id] })).rows.map((r) => Number(r.store_id));
    const step = Math.max(1, Math.floor(all.length / sample));
    for (let i = 0; i < all.length && ids.size < sample + 3; i += step) ids.add(all[i]);
    if (ids.size) plan[c.scraper] = [...ids].sort((a, b) => a - b);
  }
  return plan;
}
