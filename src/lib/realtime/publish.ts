import "server-only";
import { after } from "next/server";
import { countPublish, readRev } from "@/lib/db-scoped/feed";
import { fakeBus, fakeTransport } from "./fake";

// R16 B2 — server side of live sync: after a write action, ONE message on channel `space:<id>` with { rev, by } only
// (no item content, no names). Ably REST over fetch (no SDK on the server), 1.5 s timeout, never fails the action.

export const channelOf = (spaceId: string) => `space:${spaceId}`;
export const ablyKey = () => (process.env.ABLY_API_KEY || "").trim() || null;

/** Called by the scoped layer on the first write of an action; runs after the response. Outside a request: no-op. */
export function schedulePublish(spaceId: string, by: string) {
  try {
    after(() => publishNow(spaceId, by));
  } catch {
    // Not inside a request (scripts, tests): nobody is listening.
  }
}

export async function publishNow(spaceId: string, by: string) {
  try {
    const { rev } = await readRev(spaceId);
    const msg = { rev, by };
    if (fakeTransport()) {
      fakeBus().publish(channelOf(spaceId), msg);
      return;
    }
    const key = ablyKey();
    if (!key) return; // polling mode: clients ask changesSince themselves
    const res = await fetch(`https://rest.ably.io/channels/${encodeURIComponent(channelOf(spaceId))}/messages`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(key).toString("base64")}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "change", data: msg }),
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) await countPublish();
  } catch {
    // A failed publish never fails the action; other clients still catch up by polling on focus / online.
  }
}
