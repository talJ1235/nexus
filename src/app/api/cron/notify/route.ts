import { type NextRequest } from "next/server";
import { safeEqualStr } from "@/lib/auth/crypto";
import { kvSet } from "@/lib/kv";
import { dispatch } from "@/lib/notify/dispatch";
import { runNotifySweeps } from "@/lib/notify/senders";

export const maxDuration = 60;

// R17 S3 J3 — the hourly dispatcher (GitHub Actions `hourly.yml`, Bearer CRON_SECRET like /api/cron/prices). First the
// time-based senders (finished trips that went idle, deliveries due today, budget, the weekly summary), then everything
// due is claimed and sent. Idempotent: a row is claimed in the same write that marks it sent.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqualStr(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response("Unauthorized", { status: 401 });
  const started = Date.now();
  const sweeps = await runNotifySweeps(started).catch(() => null);
  const sent = await dispatch(Date.now());
  const summary = { at: Date.now(), ms: Date.now() - started, sweeps, ...sent };
  await kvSet("pref:last_notify", JSON.stringify(summary));
  return Response.json(summary);
}
