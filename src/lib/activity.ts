import "server-only";
import { after } from "next/server";
import { logActivity } from "./db-scoped/presence";
import type { ActivityKind } from "./presence-keys";

/** R17 G1: note what a person did — a kind + a count, written after the response (never slows or fails the action). */
export function noteActivity(who: { userId: string | null; spaceId?: string | null }, kind: ActivityKind, n = 1) {
  if (!who.userId || n <= 0) return;
  const run = () => logActivity(who.userId!, who.spaceId ?? null, kind, n);
  try {
    after(run);
  } catch {
    void run(); // outside a request (scripts, tests)
  }
}
