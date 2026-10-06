import "server-only";
import { createHmac, randomBytes } from "node:crypto";

// R16 B2 — an Ably TokenRequest signed with the API key (Ably's documented format; no SDK on the server). The browser
// exchanges it with Ably for a token: clientId = the user, capability = ONE channel with subscribe + presence, 15 min.

export const TOKEN_TTL_MS = 15 * 60_000;

export type TokenRequest = { keyName: string; ttl: number; capability: string; clientId: string; timestamp: number; nonce: string; mac: string };

export function signTokenRequest(apiKey: string, channel: string, clientId: string, now = Date.now()): TokenRequest {
  const [keyName, secret] = apiKey.split(":");
  if (!keyName || !secret) throw new Error("bad_ably_key");
  const capability = JSON.stringify({ [channel]: ["presence", "subscribe"] });
  const nonce = randomBytes(16).toString("hex");
  const text = [keyName, TOKEN_TTL_MS, capability, clientId, now, nonce, ""].join("\n");
  const mac = createHmac("sha256", secret).update(text).digest("base64");
  return { keyName, ttl: TOKEN_TTL_MS, capability, clientId, timestamp: now, nonce, mac };
}
