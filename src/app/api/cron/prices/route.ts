import { type NextRequest } from "next/server";
import { kvSet } from "@/lib/kv";
import { ensureWebhook, publicOrigin } from "@/lib/telegram";
import { repairIncomplete } from "@/lib/service";
import { runServerChecks, sendAlertDigest, sendWeeklySummary } from "@/lib/tracker";

export const maxDuration = 60;

// Daily price check (vercel.json → crons). Vercel sends `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  // Local tests: ?only=weekly&force=1 sends the weekly summary now, without the price checks.
  if (req.nextUrl.searchParams.get("only") === "weekly") {
    return Response.json(await sendWeeklySummary(publicOrigin(req.nextUrl.origin), { force: req.nextUrl.searchParams.get("force") === "1" }));
  }
  const result = await runServerChecks(28_000);
  // Links whose first read was incomplete (e.g. a guest added it while the store/AI was unavailable).
  const repair = await repairIncomplete(16_000).catch(() => ({ tried: 0, repaired: 0 }));
  const digest = await sendAlertDigest(req.nextUrl.origin);
  // Sundays (Israel): the weekly summary, after the day's alerts went out.
  const weekly = await sendWeeklySummary(publicOrigin(req.nextUrl.origin)).catch(() => ({ weekly: "failed" as const }));
  await ensureWebhook(req.nextUrl.origin).catch(() => false); // self-heal the bot webhook daily
  const summary = { at: Date.now(), checked: result.checked, blocked: result.blocked, remaining: result.remaining, alerts: result.alerts.length, sent: digest.sent, budget: "budget" in digest ? digest.budget : false, weekly: weekly.weekly, repair };
  await kvSet("pref:last_check", JSON.stringify(summary));
  return Response.json(summary);
}
