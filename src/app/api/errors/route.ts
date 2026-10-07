// R16 C2: the browser's error reports (+ R16 G2: Google sign-in failures, kind "auth"; hotfix: desktop-width phone layouts, kind "viewport") (uncaught errors, unhandled rejections, error toasts) → the error log.
// Works signed out too (login pages), so it's on the authz allow-list; every limit lives in lib/errors/intake:
// same origin, ≤ 8 KB, ≤ 10 events, strict shape, 30 events/hour per user / 10 per IP signed out → then 429.
import { z } from "zod";
import { recordError } from "@/lib/errors/record";
import { boundedBody, reporter, sameOrigin } from "@/lib/errors/intake";

const Event = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("client"), code: z.enum(["error", "rejection", "toast"]), where: z.string().max(120), message: z.string().min(1).max(300) }).strict(),
  // R16 G2: a Google sign-in that failed to open (status / timeout / network only — the email never leaves the page).
  z.object({ kind: z.literal("auth"), code: z.enum(["google_status", "google_timeout", "google_network", "google_limit"]), where: z.string().max(120), message: z.string().min(1).max(300) }).strict(),
  // Hotfix 2026-10-07: a phone page found at desktop layout width (boot-screen VIEWPORT_GUARD) — layout numbers, display
  // mode, navigation type and the referrer's host only; never content.
  z.object({ kind: z.literal("viewport"), code: z.literal("layout"), where: z.string().max(120), message: z.string().min(1).max(300) }).strict(),
]);
const Body = z.object({ events: z.array(Event).min(1).max(10) }).strict();

export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  const text = await boundedBody(req);
  if (text == null) return new Response(null, { status: 413 });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(JSON.parse(text));
  } catch {
    return new Response(null, { status: 400 });
  }
  const who = await reporter(req, "errors");
  let stored = 0;
  for (const e of body.events) {
    if (!(await who.take())) break;
    await recordError(e, who.userId);
    stored++;
  }
  return Response.json({ stored, rejected: body.events.length - stored }, { status: stored < body.events.length ? 429 : 200 });
}
