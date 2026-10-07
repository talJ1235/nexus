// R16 C2 — what an error log entry may contain. Pure (no DB): fingerprinting, normalising and redacting.
// The log never holds user content: no query strings, no emails, no quoted names (items / spaces / lists), no long
// numbers (> 6 digits); samples ≤ 500 chars.
import { createHash } from "node:crypto";

export const KINDS = ["server", "client", "extract", "ai", "cron", "csp", "auth", "viewport"] as const;
export type ErrorKind = (typeof KINDS)[number];
export type ErrorInput = { kind: ErrorKind; code: string; where: string; message: string; sample?: string | null };

const QUOTED = [/"[^"\n]{1,160}"/g, /“[^”\n]{1,160}”/g, /«[^»\n]{1,160}»/g, /„[^“\n]{1,160}“/g];

/** Remove what could identify a person or their data. */
export function redact(text: string, max = 500): string {
  let s = String(text ?? "");
  s = s.replace(/https?:\/\/[^\s"'<>)]+/g, (u) => {
    try {
      const x = new URL(u);
      return `${x.protocol}//${x.host}${x.pathname}`;
    } catch {
      return "[url]";
    }
  });
  s = s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]");
  s = s.replace(/\d{7,}/g, "[n]");
  for (const q of QUOTED) s = s.replace(q, '"…"');
  return s.slice(0, max);
}

/** The message as grouped: lowercase, no urls / ids / numbers / quoted text. */
export function normalise(message: string): string {
  // Ids first (hex, long tokens, long numbers), so they group the same whatever redaction would make of them.
  return redact(String(message ?? "").replace(/\b[0-9a-f]{8,}\b|\b[\w-]{18,}\b|\b\d{7,}\b/gi, "<id>"), 2000)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\d+/g, "#")
    .replace(/"…"/g, '""')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

const short = (s: string, n: number) => String(s ?? "").replace(/[^\w:./#@-]+/g, "_").slice(0, n) || "?";

/** kind + code + where + normalised message → one row. */
export function fingerprint(e: ErrorInput): string {
  return createHash("sha256").update([e.kind, short(e.code, 60), short(e.where, 120), normalise(e.message)].join("|")).digest("hex").slice(0, 24);
}

/** Clean an input to what may be stored. */
export function shape(e: ErrorInput) {
  return {
    fingerprint: fingerprint(e),
    kind: e.kind,
    code: short(e.code, 60),
    where: short(e.where, 120),
    message: normalise(e.message),
    sample: e.sample == null ? redact(e.message) : redact(e.sample),
  };
}

/** Only an http(s) URL's domain (extraction failures log the domain, never the link). */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").slice(0, 80);
  } catch {
    return "?";
  }
}
