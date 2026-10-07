import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// R16 G1 — a per-request `Server-Timing` header for the auth routes: where the server time went (cold start, the
// rate-limit row, the OAuth state, other DB calls, the sign-in hooks, the rest). Durations only — nothing about the
// user. src/db/index.ts reports every DB call here; outside a timed request it's a no-op.

type Phase = "rl" | "state" | "db" | "hooks";
type Store = { start: number; ms: Record<Phase, number>; n: Record<Phase, number> };
const als = new AsyncLocalStorage<Store>();
const bootAt = Date.now();
let served = 0;

/** SQL → the phase it belongs to (by table). */
function phaseOf(sql: string): Phase {
  if (/\b"?(auth_)?rate_limit"?\b/.test(sql)) return "rl";
  // On the sign-in routes the verification table only holds the OAuth state.
  if (/\b"?verification"?\b/.test(sql)) return "state";
  return "db";
}

/** Called by the DB client after each statement (or batch). */
export function noteDb(sql: string, ms: number) {
  const s = als.getStore();
  if (!s) return;
  const p = phaseOf(sql);
  s.ms[p] += ms;
  s.n[p]++;
}

/** Time a block as its own phase (the hooks); DB time inside it still counts under its own phase too. */
export async function timed<T>(phase: Phase, fn: () => Promise<T>): Promise<T> {
  const s = als.getStore();
  if (!s) return fn();
  const t = performance.now();
  try {
    return await fn();
  } finally {
    s.ms[phase] += performance.now() - t;
    s.n[phase]++;
  }
}

const header = (s: Store, cold: boolean, boot: number) => {
  const total = performance.now() - s.start;
  const own = s.ms.rl + s.ms.state + s.ms.db;
  const f = (x: number) => x.toFixed(1);
  return [
    `cold;desc="${cold ? 1 : 0}"${cold ? `;dur=${boot}` : ""}`,
    `rl;dur=${f(s.ms.rl)};desc="${s.n.rl}"`,
    `state;dur=${f(s.ms.state)};desc="${s.n.state}"`,
    `db;dur=${f(s.ms.db)};desc="${s.n.db}"`,
    `hooks;dur=${f(s.ms.hooks)};desc="${s.n.hooks}"`,
    `other;dur=${f(Math.max(0, total - own))}`,
    `total;dur=${f(total)}`,
  ].join(", ");
};

/** Wrap a route handler: run it in a timing scope and add `Server-Timing` to its response. */
export function withServerTiming<A extends unknown[]>(handler: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    const cold = served++ === 0;
    const boot = Date.now() - bootAt;
    const store: Store = { start: performance.now(), ms: { rl: 0, state: 0, db: 0, hooks: 0 }, n: { rl: 0, state: 0, db: 0, hooks: 0 } };
    const res = await als.run(store, () => handler(req, ...rest));
    const value = header(store, cold, boot);
    try {
      res.headers.append("Server-Timing", value);
      return res;
    } catch {
      // Immutable headers (Response.redirect): copy.
      const h = new Headers(res.headers);
      h.append("Server-Timing", value);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }
  };
}
