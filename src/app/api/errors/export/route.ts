import { createHash, timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { errorOverflow, listErrors } from "@/lib/db-scoped/errors";

// R16 C2: the error log as markdown for the next fix round (`node scripts/errors.mjs`). Like the reports export: not
// behind a session — authorized by REPORTS_TOKEN (Authorization: Bearer; authz allow-list); without it, disabled.
// Redacted fields only (no user data is ever stored in the log).
const digest = (s: string) => createHash("sha256").update(s).digest();

export async function GET(req: NextRequest) {
  const secret = process.env.REPORTS_TOKEN;
  if (!secret) return new Response("Not found", { status: 404 });
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!timingSafeEqual(digest(given), digest(secret))) return new Response("Unauthorized", { status: 401 });
  const all = req.nextUrl.searchParams.get("all") === "1";
  const [rows, overflow] = await Promise.all([listErrors({ status: all ? undefined : ["new", "known"], sort: "count", limit: 100 }), errorOverflow()]);
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  const md = [
    `# Nexus error log — ${rows.length} ${all ? "in total" : "open (new + known)"}${overflow ? ` · ${overflow} events over the 1 000-row cap` : ""}`,
    "",
    ...rows.map((r) => [`## ${r.kind} · ${r.code} — ${r.count}× · ${r.users} people · ${r.status}`, "", `- where: \`${r.where}\` · release ${r.release ?? "?"}`, `- first ${day(r.firstSeen)} UTC · last ${day(r.lastSeen)} UTC · fingerprint \`${r.fingerprint}\``, "", "```", r.sample ?? r.message, "```", ""].join("\n")),
  ].join("\n");
  return new Response(md, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } });
}
