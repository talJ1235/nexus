// R17 S5 S1 — which DB failures are worth one more try. Prod (Vercel → Turso over HTTP) saw bursts of "Failed query"
// on plain reads (the space list every request needs), so /api/presence and the admin polls answered 500. A read that
// failed on the way (connection reset, stream expired, a 5xx from the edge) is retried once; SQL errors never are, and
// writes never are (the first try may have landed).

const TRANSIENT = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|socket hang up|other side closed|terminated|stream (?:expired|not found|closed)|Hrana|HRANA_WEBSOCKET|UND_ERR|network|timed? ?out|\b50[234]\b|SERVER_ERROR|Too Many Requests|\b429\b/i;
const NEVER = /SQLITE_(?:ERROR|CONSTRAINT|MISMATCH|RANGE|AUTH|READONLY|TOOBIG)|no such (?:table|column)|syntax error|BLOCKED/i;

/** The error (or anything in its cause chain) looks like the network / the service, not the statement. */
export function isTransientDbError(e: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = e;
  let transient = false;
  while (cur && !seen.has(cur) && seen.size < 6) {
    seen.add(cur);
    const x = cur as { code?: unknown; message?: unknown; cause?: unknown };
    const text = `${typeof x.code === "string" ? x.code : ""} ${typeof x.message === "string" ? x.message : String(cur)}`;
    if (NEVER.test(text)) return false;
    if (TRANSIENT.test(text)) transient = true;
    cur = x.cause;
  }
  return transient;
}

/** Only statements that can't change anything are retried. */
export function isReadStatement(sql: string): boolean {
  const s = sql.replace(/^\s*(?:--[^\n]*\n\s*)*/, "").slice(0, 12).toLowerCase();
  return s.startsWith("select") || s.startsWith("pragma") || (s.startsWith("with") && !/\b(insert|update|delete)\b/i.test(sql));
}
