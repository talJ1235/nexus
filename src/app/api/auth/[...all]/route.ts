import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/server";
import { withServerTiming } from "@/lib/timing";

// Better Auth's HTTP surface (allow-listed in src/lib/auth/server.ts: nexus-guard).
// R16 G1: every response carries Server-Timing (cold / rate limit / OAuth state / DB / hooks / other / total).
const h = toNextJsHandler(auth);
export const GET = withServerTiming(h.GET);
export const POST = withServerTiming(h.POST);
