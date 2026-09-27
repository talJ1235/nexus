// Stateless session: cookie = "<expiresAtMs>.<hmac>". Works in proxy and in server code.
export const SESSION_COOKIE = "nexus_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 365;

const enc = new TextEncoder();

async function key(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function toHex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET is missing or too short");
  return s;
}

export async function createSessionValue() {
  const exp = String(Date.now() + SESSION_MAX_AGE_S * 1000);
  const sig = await crypto.subtle.sign("HMAC", await key(secret()), enc.encode(exp));
  return `${exp}.${toHex(sig)}`;
}

export async function verifySessionValue(value: string | undefined | null) {
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Number(exp) < Date.now()) return false;
  try {
    return await crypto.subtle.verify("HMAC", await key(secret()), fromHex(sig), enc.encode(exp));
  } catch {
    return false;
  }
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string) {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}
