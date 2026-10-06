// R16 C2 — every server action, route handler and server render error reaches this hook (Next's onRequestError):
// unexpected ones are recorded in the error log; expected ones (no access, validation, limits, redirects) are not.
// The client already gets Next's generic error (production masks messages).
import type { Instrumentation } from "next";

const EXPECTED = new Set(["not_found", "forbidden", "unauthorized", "limit", "invalid_url", "gone", "no_ai", "bad_request"]);

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const e = err as { name?: string; message?: string; digest?: string; code?: string };
  const name = e?.name ?? "Error";
  const message = typeof e?.message === "string" ? e.message : String(err);
  const digest = typeof e?.digest === "string" ? e.digest : "";
  if (name === "AccessError" || name === "ZodError" || EXPECTED.has(message) || /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR)/.test(digest) || /^NEXT_(REDIRECT|NOT_FOUND)/.test(message)) return;
  const headers = request.headers as Record<string, string | string[] | undefined>;
  const action = typeof headers["next-action"] === "string" ? headers["next-action"].slice(0, 16) : null;
  const where = context.routeType === "action" && action ? `action:${action}` : `${context.routeType}:${context.routePath}`;
  // A per-device stand-in for "who" (hashed with the fingerprint, never stored as is): the session cookie.
  const cookie = typeof headers.cookie === "string" ? headers.cookie : "";
  const session = /(?:^|;\s*)(?:__Secure-)?nexus_session[^=]*=([^;]+)/.exec(cookie)?.[1] ?? null;
  const { recordError } = await import("@/lib/errors/record");
  await recordError({ kind: "server", code: name.slice(0, 40), where, message, sample: `${name}: ${message}\n${(e as Error)?.stack?.split("\n").slice(1, 4).join("\n") ?? ""}` }, session);
};
