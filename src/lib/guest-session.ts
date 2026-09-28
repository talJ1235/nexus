// Guest (shared-access) session. Runs in proxy (edge) and server code — WebCrypto only.
// Cookie = "<memberId>.<expiresAtMs>.<hmac>", signed over "guest:<memberId>.<exp>" so it can never
// be mistaken for (or forged into) the owner's session, which signs just "<exp>".
export const GUEST_COOKIE = "nexus_guest";
export const GUEST_MAX_AGE_S = 60 * 60 * 24 * 365;

const enc = new TextEncoder();

async function hmac(message: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error("SESSION_SECRET is missing or too short");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createGuestValue(memberId: string) {
  const exp = String(Date.now() + GUEST_MAX_AGE_S * 1000);
  return `${memberId}.${exp}.${await hmac(`guest:${memberId}.${exp}`)}`;
}

/** Returns the member id if the cookie is authentic and unexpired (revocation is checked against the DB later). */
export async function verifyGuestValue(value: string | undefined | null): Promise<string | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [memberId, exp, sig] = parts;
  if (!/^[\w-]{6,40}$/.test(memberId) || !/^\d{10,16}$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  if (Number(exp) < Date.now()) return null;
  const want = await hmac(`guest:${memberId}.${exp}`);
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? memberId : null;
}

export async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
