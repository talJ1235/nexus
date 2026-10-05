import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/server";

// Better Auth's HTTP surface (allow-listed in src/lib/auth/server.ts: nexus-guard).
export const { GET, POST } = toNextJsHandler(auth);
