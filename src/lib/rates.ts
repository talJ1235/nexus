import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { FALLBACK_RATES, type Rates } from "./money";

const KEY = "fx_rates";
const TTL = 12 * 60 * 60 * 1000;

export async function getRates(): Promise<Rates> {
  let cached: Rates | null = null;
  try {
    const row = await db.query.kv.findFirst({ where: eq(schema.kv.key, KEY) });
    if (row) cached = JSON.parse(row.value) as Rates;
  } catch {
    /* db unavailable — fall through */
  }
  if (cached && Date.now() - cached.fetchedAt < TTL) return cached;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch("https://api.frankfurter.dev/v1/latest?base=USD", { signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { rates: Record<string, number> };
    const fresh: Rates = { base: "USD", rates: { ...data.rates, USD: 1 }, fetchedAt: Date.now() };
    await db
      .insert(schema.kv)
      .values({ key: KEY, value: JSON.stringify(fresh), updatedAt: Date.now() })
      .onConflictDoUpdate({ target: schema.kv.key, set: { value: JSON.stringify(fresh), updatedAt: Date.now() } });
    return fresh;
  } catch {
    return cached ?? FALLBACK_RATES;
  }
}
