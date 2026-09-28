import { type NextRequest } from "next/server";
import { kvSet } from "@/lib/kv";
import { ensureWebhook } from "@/lib/telegram";
import { runServerChecks, sendAlertDigest } from "@/lib/tracker";

export const maxDuration = 60;

// Daily price check (vercel.json → crons). Vercel sends `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const result = await runServerChecks(42_000);
  const digest = await sendAlertDigest(req.nextUrl.origin);
  await ensureWebhook(req.nextUrl.origin).catch(() => false); // self-heal the bot webhook daily
  const summary = { at: Date.now(), checked: result.checked, blocked: result.blocked, remaining: result.remaining, alerts: result.alerts.length, sent: digest.sent };
  await kvSet("pref:last_check", JSON.stringify(summary));
  return Response.json(summary);
}
