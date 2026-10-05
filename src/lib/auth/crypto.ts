// Small crypto helpers for auth (Node runtime: server code and proxy). Secrets never leave the server.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

function secret() {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("BETTER_AUTH_SECRET is missing or too short");
  return s;
}

export function hmac(message: string) {
  return createHmac("sha256", secret()).update(message).digest("base64url");
}

export function safeEqualStr(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** "<payload>.<hmac>" with an expiry inside — for short-lived HttpOnly cookies (invite through the Google redirect). */
export function signValue(payload: Record<string, unknown>, ttlMs: number) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString("base64url");
  return `${body}.${hmac(`v1:${body}`)}`;
}

export function verifyValue<T extends Record<string, unknown>>(value: string | undefined | null): T | null {
  if (!value) return null;
  const i = value.lastIndexOf(".");
  if (i <= 0) return null;
  const body = value.slice(0, i);
  if (!safeEqualStr(value.slice(i + 1), hmac(`v1:${body}`))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    return typeof data.exp === "number" && data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

/** Keyed hash of an IP (never stored raw). */
export function ipHash(ip: string | null | undefined) {
  return ip ? hmac(`ip:${ip}`).slice(0, 22) : null;
}

/** Sign-up code alphabet without look-alikes (0/O, 1/I/L, 5/S, 2/Z, 8/B). */
const CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";

export function newInviteCode() {
  const pick = () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${Array.from({ length: 3 }, pick).join("")}-${Array.from({ length: 4 }, pick).join("")}`;
}

/** Normalise what a person typed: case, spaces, missing dash. Returns null when it can't be a code. */
export function normalizeInviteCode(input: string) {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 7 || [...raw].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

/** Small secrets the admin must see again (invite codes): AES-256-GCM with a key derived from BETTER_AUTH_SECRET. */
function encKey() {
  return createHash("sha256").update(`enc:v1:${secret()}`).digest();
}
export function encrypt(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `${iv.toString("base64url")}.${body.toString("base64url")}.${c.getAuthTag().toString("base64url")}`;
}
export function decrypt(value: string | null | undefined) {
  if (!value) return null;
  try {
    const [iv, body, tag] = value.split(".").map((x) => Buffer.from(x, "base64url"));
    const d = createDecipheriv("aes-256-gcm", encKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
