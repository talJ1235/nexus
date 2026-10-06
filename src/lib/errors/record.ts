import "server-only";
import { createHmac } from "node:crypto";
import { after } from "next/server";
import { storeError } from "@/lib/db-scoped/errors";
import { shape, type ErrorInput } from "./shape";

// R16 C2 — record an error (server, extraction, AI, cron, client, CSP). Never throws into the app and never waits more
// than 1.5 s; the user is only a hash (per fingerprint), so the log counts people without naming them.

export const release = () => (process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXUS_RELEASE || "local").slice(0, 12);

const userHash = (userId: string, fp: string) => createHmac("sha256", process.env.BETTER_AUTH_SECRET || process.env.SESSION_SECRET || "nexus").update(`${userId}|${fp}`).digest("base64url").slice(0, 22);

export async function recordError(e: ErrorInput, userId?: string | null) {
  try {
    const s = shape(e);
    await Promise.race([storeError({ ...s, release: release(), userHash: userId ? userHash(userId, s.fingerprint) : null }), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    // The error log must never break what it watches.
  }
}

/** Fire-and-forget: after the response when inside a request, otherwise in the background. */
export function reportError(e: ErrorInput, userId?: string | null) {
  try {
    after(() => recordError(e, userId));
  } catch {
    void recordError(e, userId);
  }
}
