// R15 A1 unit tests: authMode(), the admin-fallback guard, the 90-day absolute session age, ?next= safety, cookie
// names, invite-code normalisation.   npx tsx scripts/test-auth-config.ts
import assert from "node:assert/strict";
import { adminEmail, authMode, emergencyEmails, emergencyEnabled, isAdminEmail, isListedAdmin, safeNext, SESSION_ABSOLUTE_MS, sessionCookieName, sessionTooOld, testIdpEnabled } from "../src/lib/auth/config";
import { newInviteCode, normalizeInviteCode } from "../src/lib/auth/crypto";

const FULL = { NEXT_PUBLIC_APP_URL: "https://karto.app", RESEND_API_KEY: "re_x" };

// authMode: full only on the app's own host with Resend; localhost only with AUTH_FULL_LOCAL=1.
assert.equal(authMode("karto.app", FULL), "full");
assert.equal(authMode("KARTO.APP", FULL), "full");
assert.equal(authMode("nexus-ashen-beta.vercel.app", FULL), "closed", "other host");
assert.equal(authMode("karto.app", { NEXT_PUBLIC_APP_URL: "https://karto.app" }), "closed", "no Resend");
assert.equal(authMode("karto.app", { RESEND_API_KEY: "x" }), "closed", "no domain");
assert.equal(authMode("nexus-ashen-beta.vercel.app", {}), "closed");
assert.equal(authMode("localhost:3100", { AUTH_FULL_LOCAL: "1" }), "full");
assert.equal(authMode("127.0.0.1:3100", { AUTH_FULL_LOCAL: "1" }), "full");
assert.equal(authMode("localhost:3100", {}), "closed");
assert.equal(authMode("evil.com", { AUTH_FULL_LOCAL: "1" }), "closed", "AUTH_FULL_LOCAL never applies off localhost");
assert.equal(authMode("localhost.evil.com", { AUTH_FULL_LOCAL: "1" }), "closed");
assert.equal(authMode(null, FULL), "closed");
assert.equal(authMode("karto.app", { ...FULL, NEXT_PUBLIC_APP_URL: "not a url" }), "closed");

// R17 E1: no password sign-in; the admin emergency path is on only with a long ADMIN_EMERGENCY_TOKEN and an admin address.
const tok = "t".repeat(32);
assert.equal(emergencyEnabled({ ADMIN_EMERGENCY_TOKEN: tok, ADMIN_EMAIL: "a@b.c" }), true);
assert.equal(emergencyEnabled({ ADMIN_EMERGENCY_TOKEN: "t".repeat(31), ADMIN_EMAIL: "a@b.c" }), false, "short token → off");
assert.equal(emergencyEnabled({ ADMIN_EMAIL: "a@b.c" }), false, "no token → off");
assert.equal(emergencyEnabled({ ADMIN_EMERGENCY_TOKEN: tok }), false, "no admin → off");
assert.equal(emergencyEnabled({ APP_PASSWORD: "x".repeat(40), ADMIN_EMAIL: "a@b.c" }), false, "the old APP_PASSWORD does nothing");
assert.deepEqual(emergencyEmails({ ADMIN_EMAILS: " A@b.c, x@y.z ,bad", ADMIN_EMAIL: "a@b.c" }), ["a@b.c", "x@y.z"]);
assert.equal(emergencyEnabled({ ADMIN_EMERGENCY_TOKEN: tok, ADMIN_EMAIL: "not-an-email" }), false);
// The emergency path signs in only an address on the admin list (lib/auth/server.ts emergencySignIn).
assert.equal(adminEmail({ ADMIN_EMAIL: " Tal@Example.COM " }), "tal@example.com");
assert.equal(isAdminEmail("tal@example.com", { ADMIN_EMAIL: "TAL@example.com" }), true);
assert.equal(isAdminEmail("other@example.com", { ADMIN_EMAIL: "tal@example.com" }), false);
assert.equal(isAdminEmail("tal@example.com", {}), false);
// R17 P8: the admin role follows every address in ADMIN_EMAILS plus ADMIN_EMAIL (case and spaces ignored).
assert.equal(isListedAdmin("Tal@Gmail.com", { ADMIN_EMAIL: "other@example.com", ADMIN_EMAILS: " tal@gmail.com , x@y.z" }), true);
assert.equal(isListedAdmin("other@example.com", { ADMIN_EMAIL: "other@example.com", ADMIN_EMAILS: "tal@gmail.com" }), true);
assert.equal(isListedAdmin("someone@example.com", { ADMIN_EMAIL: "other@example.com", ADMIN_EMAILS: "tal@gmail.com" }), false);
assert.equal(isListedAdmin("", { ADMIN_EMAILS: "tal@gmail.com" }), false);
assert.equal(isListedAdmin("tal@gmail.com", {}), false);

// Absolute age: reject after 90 days however active.
const now = Date.UTC(2026, 9, 5);
assert.equal(sessionTooOld(now - SESSION_ABSOLUTE_MS + 1000, now), false);
assert.equal(sessionTooOld(now - SESSION_ABSOLUTE_MS - 1000, now), true);
assert.equal(sessionTooOld(new Date(now - 91 * 86_400_000), now), true);
assert.equal(sessionTooOld(Number.NaN, now), true);

// Open-redirect guard.
assert.equal(safeNext("/?v=to_buy"), "/?v=to_buy");
for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "", null]) assert.equal(safeNext(bad), "/");

// Cookie names: __Host- on https, a dev name on plain-http localhost.
assert.equal(sessionCookieName("https://nexus-ashen-beta.vercel.app"), "__Host-nexus_session");
assert.equal(sessionCookieName("http://localhost:3100"), "nexus_session_dev");

// Test IdP: never in production.
assert.equal(testIdpEnabled({ AUTH_TEST_IDP: "1", NODE_ENV: "production" }), false);
assert.equal(testIdpEnabled({ AUTH_TEST_IDP: "1", NODE_ENV: "development" }), true);
assert.equal(testIdpEnabled({ NODE_ENV: "development" }), false);

// Invite codes: XXX-XXXX, no look-alikes, typed loosely.
for (let i = 0; i < 200; i++) {
  const c = newInviteCode();
  assert.match(c, /^[ACDEFGHJKMNPQRTUVWXY34679]{3}-[ACDEFGHJKMNPQRTUVWXY34679]{4}$/);
  assert.equal(normalizeInviteCode(c.toLowerCase().replace("-", " ")), c);
}
assert.equal(normalizeInviteCode("O0I-1LB8"), null, "look-alike characters are never valid");
assert.equal(normalizeInviteCode("ACD-EFG"), null);

console.log("OK auth config: authMode, fallback guard, absolute age, next, cookies, test IdP, invite codes");
