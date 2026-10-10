import { type NextRequest } from "next/server";
import { safeEqualStr } from "@/lib/auth/crypto";
import { kvSet } from "@/lib/kv";
import { DISPATCH_EVERY_MS, LEASE_KEY, runDispatcher } from "@/lib/notify/maybe";

export const maxDuration = 60;

// R17 S3 J3 — the hourly dispatcher (GitHub Actions `hourly.yml`, Bearer CRON_SECRET like /api/cron/prices). First the
// time-based senders (finished trips that went idle, deliveries due today, budget, the weekly summary), then everything
// due is claimed and sent. Idempotent: a row is claimed in the same write that marks it sent. R17 S6 U3: signed-in
// requests run the same thing every 5 min (lib/notify/maybe.ts) — this stays the safety net for nights / nobody online;
// it always runs and takes the lease so an app request doesn't repeat it at once.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqualStr(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response("Unauthorized", { status: 401 });
  const started = Date.now();
  await kvSet(LEASE_KEY, String(started + DISPATCH_EVERY_MS));
  return Response.json(await runDispatcher("cron", started));
}
