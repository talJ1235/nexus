// R19 D5 — the catalog search's server time for 3 letters (FTS5 trigram + the price at the store + ranking), p50 / p95.
//   TURSO_DATABASE_URL=file:copy.db npx tsx --conditions=react-server scripts/prices/search-bench.ts
import { catalogSearch } from "@/lib/db-scoped/prices";

const QS = ["פסט", "חלב", "במב", "קוט", "לחם", "ביצ", "גבי", "יוג", "שוק", "קפה", "אור", "טחי", "חומ", "עגב", "מלפ", "שמן", "סוכ", "מלח", "קמח", "ציפ"];
async function main() {
  const at = { branchId: "rami-levy:1", chainId: "rami-levy" };
  for (const q of QS.slice(0, 3)) await catalogSearch(q, at, { limit: 8 });
  const ts: number[] = [];
  let hits = 0;
  for (let round = 0; round < 3; round++)
    for (const q of QS) {
      const t0 = performance.now();
      hits += (await catalogSearch(q, at, { limit: 8 })).length;
      ts.push(performance.now() - t0);
    }
  ts.sort((a, b) => a - b);
  const p = (x: number) => ts[Math.min(ts.length - 1, Math.floor(ts.length * x))].toFixed(1);
  console.log(`OK search-bench: ${ts.length} searches of 3 letters · p50 ${p(0.5)} ms · p95 ${p(0.95)} ms · max ${ts.at(-1)!.toFixed(1)} ms · ${(hits / ts.length).toFixed(1)} hits each`);
}
main().then(() => process.exit(0), (e) => (console.error(e), process.exit(1)));
