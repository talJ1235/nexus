import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aiHealth, aiProviders, lastAiErrors } from "../ai";
import { telegramStatus } from "../telegram";
import type { ClientDiag } from "../client-diag";

let cached: string | null = null;
/** The help knowledge file (traced into the server bundle by next.config's outputFileTracingIncludes). */
export function helpText(): string {
  if (cached == null) {
    try {
      cached = readFileSync(join(process.cwd(), "src/lib/help/nexus-help.md"), "utf8");
    } catch {
      cached = "";
    }
  }
  return cached;
}

export type ServerDiag = { aiProviders: string[]; aiCooling: number; aiRecentErrors: number; blob: boolean; telegram: boolean; commit: string | null };

/** Server-side facts for troubleshooting — booleans and counts, never secrets. */
export async function serverDiag(): Promise<ServerDiag> {
  const tg = await telegramStatus().catch(() => null);
  const now = Date.now();
  return {
    aiProviders: aiProviders(),
    aiCooling: Object.values(aiHealth().cooling).filter((until) => until > now).length,
    aiRecentErrors: Object.values(lastAiErrors).filter((e) => now - Date.parse(e.slice(0, 24)) < 30 * 60_000).length,
    blob: !!process.env.BLOB_READ_WRITE_TOKEN,
    telegram: !!tg?.connected,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  };
}

/** Plain lines for the model. */
export function diagLines(client: ClientDiag | null | undefined, server: ServerDiag): string {
  const out = [
    `AI providers configured: ${server.aiProviders.join(", ") || "none"}; cooling down now: ${server.aiCooling}; errors in the last 30 min: ${server.aiRecentErrors}`,
    `Receipt/attachment storage (Blob): ${server.blob ? "configured" : "NOT configured"}`,
    `Telegram: ${server.telegram ? "linked" : "not linked"}`,
  ];
  if (client) {
    out.push(
      `Browser extension: ${client.extension ? `connected, v${client.extension}` : "not detected on this page (not installed, disabled, or a phone)"}`,
      `Device: ${client.device}, viewport ${client.viewport}, ${client.online ? "online" : "OFFLINE"}; view ${client.view}; palette ${client.palette} ${client.mode}; language ${client.locale}; app ${client.version}`,
      client.errors.length ? `Recent app errors (newest last): ${client.errors.slice(-5).map((e) => `${e.kind}: ${e.message}`).join(" | ")}` : "Recent app errors: none",
    );
  }
  return out.join("\n");
}
