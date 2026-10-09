import "server-only";
import { after } from "next/server";
import { logActivity } from "./db-scoped/presence";
import type { ActivityKind } from "./presence-keys";

/** R17 G1: note what a person did — a kind + a count, written after the response (never slows or fails the action). */
export function noteActivity(who: { userId: string | null; spaceId?: string | null }, kind: ActivityKind, n = 1) {
  if (!who.userId || n <= 0) return;
  const run = async () => {
    await logActivity(who.userId!, who.spaceId ?? null, kind, n);
    // R17 S3 M2: adds / check-offs in a shared space → the other members' grouped "Noa added 5" row.
    if (kind === "items_added" || kind === "checked_off") {
      const { sharedActivity } = await import("./notify/senders");
      await sharedActivity(who.userId!, who.spaceId ?? null, kind, n).catch(() => {});
    }
  };
  try {
    after(run);
  } catch {
    void run(); // outside a request (scripts, tests)
  }
}
