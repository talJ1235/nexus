import { del } from "@vercel/blob";
import { type NextRequest } from "next/server";
import { safeEqualStr } from "@/lib/auth/crypto";
import { Scoped } from "@/lib/db-scoped";
import { purgeSpaceData } from "@/lib/db-scoped/spaces";
import { purgeTombstones } from "@/lib/db-scoped/feed";
import { dropOldSamples } from "@/lib/db-scoped/errors";
import { reportError } from "@/lib/errors/record";
import { systemSpaces } from "@/lib/db-scoped/system";
import { kvSet } from "@/lib/kv";
import { normalizeOldPictures } from "@/lib/picture-backfill";
import { backfillImages } from "@/lib/product-image";
import { getProfile } from "@/lib/profile-server";
import { repairIncomplete } from "@/lib/service";
import { dropSpaceRows, spacesToPurge } from "@/lib/spaces";
import { ownerPrefs, runCronChecks } from "@/lib/tracker";

export const maxDuration = 60;

/** R16 C2: a failed cron step → the error log (step name + message), and the run goes on with the fallback. */
const failed =
  <T,>(step: string, fallback: T) =>
  (e: unknown): T => {
    reportError({ kind: "cron", code: step, where: `cron:${step}`, message: String((e as Error)?.message ?? e) });
    return fallback;
  };

/** R15 C3: spaces deleted more than 7 days ago — their rows, then their files, then the space itself. */
async function purgeDeletedSpaces() {
  let n = 0;
  for (const { id } of await spacesToPurge()) {
    const urls = await purgeSpaceData(id);
    if (urls.length && process.env.BLOB_READ_WRITE_TOKEN) await del(urls).catch(() => {});
    await dropSpaceRows(id);
    n++;
  }
  return n;
}

// Daily price check (vercel.json → crons). Vercel sends `Authorization: Bearer $CRON_SECRET` (authz allow-list:
// CRON_SECRET, no user). R15 B3: price checks fan out over every space with one fetch per normalized URL; the
// maintenance passes run per space through that space's Scoped handle. No Telegram (D2).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqualStr(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response("Unauthorized", { status: 401 });
  const started = Date.now();
  const result = await runCronChecks(26_000).catch(failed("price-checks", { fetched: 0, checked: 0, blocked: 0, remaining: 0, alerts: [] as unknown[] }));
  const spaces = await systemSpaces();
  const repair = { tried: 0, repaired: 0 };
  const images = { tried: 0, filled: 0 };
  const pictures = { tried: 0, done: 0 };
  // Maintenance gets what's left of the minute, shared over the spaces (oldest work is retried on later runs).
  for (const sp of spaces) {
    const left = 50_000 - (Date.now() - started);
    if (left < 3_000) break;
    const s = new Scoped({ spaceId: sp.id, userId: sp.ownerId, by: "system" });
    const share = Math.max(2_000, Math.floor(left / Math.max(1, spaces.length)));
    const r = await repairIncomplete(s, share * 0.5).catch(failed("repair", { tried: 0, repaired: 0 }));
    const i = await backfillImages(s, share * 0.3).catch(failed("images", { tried: 0, filled: 0 }));
    const p = await normalizeOldPictures(s, share * 0.2, 10).catch(failed("pictures", { tried: 0, done: 0 }));
    repair.tried += r.tried;
    repair.repaired += r.repaired;
    images.tried += i.tried;
    images.filled += i.filled;
    pictures.tried += p.tried;
    pictures.done += p.done;
    // The shopping profile the assistant uses (Round 9 C3), refreshed for the space's creator.
    if (sp.ownerId) {
      const { currency } = await ownerPrefs(sp.ownerId);
      await getProfile({ user: { id: sp.ownerId }, space: { id: sp.id } }, currency, true).catch(failed("profile", null));
    }
  }
  const purged = await purgeDeletedSpaces().catch(failed("purge-spaces", 0));
  // R16 B1: change-feed tombstones are kept 30 days. C2: error samples too (counts stay).
  const tombstones = await purgeTombstones().catch(failed("tombstones", 0));
  const errorSamples = await dropOldSamples().catch(failed("error-samples", 0));
  const summary = { at: Date.now(), spaces: spaces.length, fetched: result.fetched, checked: result.checked, blocked: result.blocked, remaining: result.remaining, alerts: result.alerts.length, repair, images, pictures, purged, tombstones, errorSamples };
  await kvSet("pref:last_check", JSON.stringify(summary));
  return Response.json(summary);
}
