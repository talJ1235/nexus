import "server-only";
import { passkey } from "@better-auth/passkey";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import { admin, captcha, emailOTP, genericOAuth, organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, schema } from "@/db";
import { APP_NAME } from "@/lib/brand";
import { addMember, ensurePersonalSpace, firstName } from "@/lib/spaces";
import { adminEmail, authMode, fallbackEnabled, isAdminEmail, SESSION_IDLE_S, sessionCookieName, STEP_UP_MS, testIdpEnabled } from "./config";
import { safeEqualStr } from "./crypto";
import { codeEmail, sendEmail } from "./email";
import { logSecurityEvent, requestCity } from "./events";
import { checkInviteCookie, consumeJoinToken, consumeSignupCode, INVITE_COOKIE, readInviteCookie } from "./invites";
import { DAY, HOUR, hitLimit } from "./limits";

// R15 A1 — accounts with Better Auth. SECURITY.md §2–§4, MULTIUSER.md §4.1. The HTTP surface is an allow-list (below):
// every space/member/admin write goes through Nexus's own server actions (requireCtx), never the plugins' routes.

const baseURL = process.env.BETTER_AUTH_URL || "http://localhost:3100";
const https = baseURL.startsWith("https://");
const appUrl = process.env.NEXT_PUBLIC_APP_URL;

function cookieValue(headers: Headers | undefined | null, name: string) {
  const raw = headers?.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
}

/** Host of the incoming request (proxies set x-forwarded-host). */
export function requestHost(headers: Headers | null | undefined) {
  return headers?.get("x-forwarded-host") ?? headers?.get("host") ?? "";
}

// ---- roles (owner / member / viewer) — the organization plugin's routes are closed; this only names the roles ----
const ac = createAccessControl({ space: ["update", "delete"], data: ["read", "write"], people: ["manage"] } as const);
const roles = {
  owner: ac.newRole({ space: ["update", "delete"], data: ["read", "write"], people: ["manage"] }),
  member: ac.newRole({ data: ["read", "write"] }),
  viewer: ac.newRole({ data: ["read"] }),
};

// ---- the HTTP allow-list ----
type Gate = { re: RegExp; when?: (req: Request) => boolean };
const full = (req: Request) => authMode(requestHost(req.headers)) === "full";
const ALLOWED: Gate[] = [
  { re: /^\/get-session$/ },
  { re: /^\/sign-out$/ },
  { re: /^\/sign-in\/social$/ },
  { re: /^\/callback\/google$/ },
  { re: /^\/callback\/test-idp$/, when: () => testIdpEnabled() },
  { re: /^\/passkey\/(generate-register-options|verify-registration|generate-authenticate-options|verify-authentication)$/, when: full },
  { re: /^\/email-otp\/send-verification-otp$/, when: full },
  { re: /^\/sign-in\/email-otp$/, when: full },
  { re: /^\/fallback\/sign-in$/, when: (req) => fallbackEnabled(authMode(requestHost(req.headers))) },
  { re: /^\/ok$/ },
  { re: /^\/error$/ },
];

const nexusGuard = {
  id: "nexus-guard",
  async onRequest(request: Request) {
    const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "") || "/";
    const gate = ALLOWED.find((g) => g.re.test(path));
    if (!gate || (gate.when && !gate.when(request))) return { response: new Response(null, { status: 404 }) };
  },
  hooks: {
    before: [
      {
        // Step-up (SECURITY.md §2): adding a passkey needs a sign-in within the last 10 minutes.
        matcher: (ctx) => ctx.path === "/passkey/generate-register-options",
        handler: createAuthMiddleware(async (ctx) => {
          const s = await getSessionFromCtx(ctx);
          if (!s) throw new APIError("UNAUTHORIZED");
          if (Date.now() - new Date(s.session.createdAt).getTime() > STEP_UP_MS) throw new APIError("FORBIDDEN", { code: "step_up_required", message: "step_up_required" });
        }),
      },
      {
        // Email codes only for "sign-in" (= recovery of an existing account), max 3 per email per hour (IP: rateLimit).
        matcher: (ctx) => ctx.path === "/email-otp/send-verification-otp",
        handler: createAuthMiddleware(async (ctx) => {
          const body = (ctx.body ?? {}) as { email?: unknown; type?: unknown };
          if (body.type !== "sign-in" || typeof body.email !== "string" || body.email.length > 254) throw new APIError("BAD_REQUEST");
        }),
      },
      {
        // Admins (L3) can't recover by email code alone — they use a recovery code. Same answer as a wrong code.
        matcher: (ctx) => ctx.path === "/sign-in/email-otp",
        handler: createAuthMiddleware(async (ctx) => {
          const email = (ctx.body as { email?: unknown } | undefined)?.email;
          if (typeof email === "string" && isAdminEmail(email)) throw new APIError("BAD_REQUEST", { code: "INVALID_OTP", message: "Invalid OTP" });
        }),
      },
    ],
  },
  rateLimit: [{ pathMatcher: (p: string) => p === "/fallback/sign-in", window: 60, max: 5 }],
} satisfies BetterAuthPlugin;

// ---- admin password fallback (closed-circle mode only) ----
const nexusFallback = {
  id: "nexus-fallback",
  endpoints: {
    fallbackSignIn: createAuthEndpoint("/fallback/sign-in", { method: "POST", body: z.object({ password: z.string().max(200) }).strict() }, async (ctx) => {
      const headers = ctx.request?.headers ?? ctx.headers;
      const mode = authMode(requestHost(headers));
      const expected = process.env.APP_PASSWORD ?? "";
      if (!fallbackEnabled(mode) || !expected) throw new APIError("NOT_FOUND");
      const email = adminEmail()!;
      const ip = headers?.get("x-real-ip") ?? headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
      // 5/min per IP via rateLimit above; 20/day per IP here.
      if (!(await hitLimit(`fallback:day:${ip}`, 20, DAY))) throw new APIError("TOO_MANY_REQUESTS");
      const found = await ctx.context.internalAdapter.findUserByEmail(email);
      if (!safeEqualStr(ctx.body.password, expected) || !found?.user) {
        if (found?.user) await logSecurityEvent(found.user.id, "fallback_failed", null, headers);
        await new Promise((r) => setTimeout(r, 600));
        throw new APIError("UNAUTHORIZED", { code: "bad_password", message: "bad_password" });
      }
      // Only ever the ADMIN_EMAIL user — there is no input that could choose anyone else.
      const session = await ctx.context.internalAdapter.createSession(found.user.id);
      await setSessionCookie(ctx, { session, user: found.user });
      return ctx.json({ ok: true });
    }),
  },
} satisfies BetterAuthPlugin;

function sessionMethod(path: string | undefined) {
  if (!path) return null;
  if (path.startsWith("/callback/google")) return "google";
  if (path.startsWith("/callback/test-idp")) return "test-idp";
  if (path.startsWith("/passkey/")) return "passkey";
  if (path.startsWith("/sign-in/email-otp")) return "email-otp";
  if (path.startsWith("/fallback/")) return "fallback";
  return null;
}

/** Text the user can see, never secret: for the waitlist screen we keep the Google email server-side under an opaque id. */
async function rememberPendingEmail(email: string) {
  const id = nanoid(24);
  await db.insert(schema.verification).values({ id: nanoid(), identifier: `pending-signup:${id}`, value: email, expiresAt: new Date(Date.now() + 10 * 60_000), createdAt: new Date(), updatedAt: new Date() });
  return id;
}

const plugins: BetterAuthPlugin[] = [
  nexusGuard,
  nexusFallback,
  organization({
    ac,
    roles,
    creatorRole: "owner",
    allowUserToCreateOrganization: false,
    schema: {
      organization: {
        additionalFields: {
          kind: { type: "string", required: true, defaultValue: "shared", input: false },
          currency: { type: "string", required: true, defaultValue: "ILS" },
          color: { type: "string", required: true, defaultValue: "plum" },
          icon: { type: "string", required: true, defaultValue: "home" },
          createdBy: { type: "string", required: false, input: false },
          deletedAt: { type: "number", required: false, input: false },
        },
      },
    },
  }),
  admin({ defaultRole: "user", adminRoles: ["admin"] }),
  passkey({
    rpID: appUrl ? new URL(appUrl).hostname : "localhost",
    rpName: APP_NAME,
    origin: appUrl ? new URL(appUrl).origin : baseURL,
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    authentication: {
      afterVerification: async ({ verification, clientData }) => {
        if (!verification.authenticationInfo.userVerified) throw new APIError("UNAUTHORIZED", { code: "user_verification_required" });
        await db.update(schema.passkey).set({ lastUsedAt: new Date() }).where(eq(schema.passkey.credentialID, clientData.id));
      },
    },
    registration: {
      afterVerification: async ({ ctx, user }) => {
        await logSecurityEvent(user.id, "passkey_added", null, ctx.request?.headers ?? ctx.headers);
      },
    },
  }),
  emailOTP({
    disableSignUp: true,
    otpLength: 6,
    expiresIn: 600,
    allowedAttempts: 5,
    storeOTP: "hashed",
    rateLimit: { window: 3600, max: 3 },
    async sendVerificationOTP({ email, otp, type }, ctx) {
      if (type !== "sign-in" || isAdminEmail(email)) return;
      // Per email (the plugin limits per IP). Over the limit → silently nothing; the response stays identical.
      if (!(await hitLimit(`otp:email:${email.toLowerCase()}`, 3, HOUR))) return;
      const locale = ctx?.headers?.get("accept-language")?.startsWith("he") ? "he" : "en";
      await sendEmail({ to: email, ...codeEmail(otp, locale) });
    },
  }),
  ...(process.env.TURNSTILE_SECRET_KEY
    ? [captcha({ provider: "cloudflare-turnstile", secretKey: process.env.TURNSTILE_SECRET_KEY, endpoints: ["/email-otp/send-verification-otp"] })]
    : []),
  ...(testIdpEnabled()
    ? [
        genericOAuth({
          config: [
            {
              providerId: "test-idp",
              clientId: "nexus-test",
              clientSecret: "nexus-test-secret",
              authorizationUrl: `${baseURL}/api/test-idp/authorize`,
              tokenUrl: `${baseURL}/api/test-idp/token`,
              userInfoUrl: `${baseURL}/api/test-idp/userinfo`,
              scopes: ["openid", "email", "profile"],
              pkce: true,
            },
          ],
        }),
      ]
    : []),
  nextCookies(),
];

export const auth = betterAuth({
  appName: APP_NAME,
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  telemetry: { enabled: false },
  trustedOrigins: [baseURL, ...(appUrl ? [appUrl] : [])],
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      passkey: schema.passkey,
      organization: schema.space,
      member: schema.member,
      invitation: schema.invitation,
      rateLimit: schema.authRateLimit,
    },
  }),
  socialProviders: process.env.GOOGLE_CLIENT_ID
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
          scope: ["openid", "email", "profile"],
          prompt: "select_account",
        },
      }
    : {},
  account: { accountLinking: { enabled: true, trustedProviders: [], requireLocalEmailVerified: true } },
  session: {
    expiresIn: SESSION_IDLE_S,
    updateAge: 24 * 60 * 60,
    freshAge: STEP_UP_MS / 1000,
    additionalFields: {
      method: { type: "string", required: false, input: false },
      city: { type: "string", required: false, input: false },
    },
  },
  rateLimit: { enabled: true, storage: "database", window: 60, max: 100, customRules: { "/sign-in/email-otp": { window: 60, max: 5 }, "/sign-in/social": { window: 60, max: 10 } } },
  advanced: {
    useSecureCookies: false, // the names below carry their own prefix; Secure is set from the URL
    cookiePrefix: "nexus",
    defaultCookieAttributes: { secure: https, sameSite: "lax", httpOnly: true, path: "/" },
    cookies: { session_token: { name: sessionCookieName(baseURL), attributes: { secure: https } } },
    ipAddress: { ipAddressHeaders: ["x-real-ip", "x-forwarded-for"] },
    database: { generateId: () => nanoid() },
  },
  onAPIError: { errorURL: "/login" },
  user: {
    async validateUserInfo(data, ctx) {
      if (data.source.method === "oauth" && !data.user.emailVerified) return { error: "email_not_verified" };
      if (data.source.action !== "create-user") return;
      // The admin is created by the migration; a new account for that email is never made here.
      if (isAdminEmail(data.user.email)) return { error: "admin_must_link" };
      const headers = ctx?.request?.headers ?? ctx?.headers;
      const check = await checkInviteCookie(readInviteCookie(cookieValue(headers, INVITE_COOKIE)));
      if (!check.ok) {
        const ref = data.user.email ? await rememberPendingEmail(String(data.user.email)) : "";
        return { error: check.problem === "invalid" ? "invite_required" : `invite_${check.problem}`, errorDescription: ref };
      }
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (u, ctx) => {
          const headers = ctx?.request?.headers ?? ctx?.headers;
          const check = await checkInviteCookie(readInviteCookie(cookieValue(headers, INVITE_COOKIE)));
          if (check.ok && check.kind === "code") await consumeSignupCode(check.id, u.id);
          await ensurePersonalSpace(u.id, firstName(u.name, u.email));
          if (check.ok && check.kind === "join") {
            const used = await consumeJoinToken(check.id);
            if (used) await addMember(used.spaceId, u.id, used.role);
          }
          if (check.ok) await logSecurityEvent(u.id, "invite_used", { kind: check.kind }, headers);
        },
      },
    },
    session: {
      create: {
        before: async (s, ctx) => {
          const headers = ctx?.request?.headers ?? ctx?.headers;
          return { data: { ...s, method: sessionMethod(ctx?.path), city: requestCity(headers) } };
        },
        after: async (s, ctx) => {
          const headers = ctx?.request?.headers ?? ctx?.headers;
          const method = sessionMethod(ctx?.path);
          // Rotation: a sign-in from a browser that already had a session replaces it.
          const old = cookieValue(headers, sessionCookieName(baseURL))?.split(".")[0];
          if (old && old !== s.token) await db.delete(schema.session).where(and(eq(schema.session.token, old), eq(schema.session.userId, s.userId)));
          const ua = headers?.get("user-agent") ?? "";
          const others = await db
            .select({ ua: schema.session.userAgent })
            .from(schema.session)
            .where(and(eq(schema.session.userId, s.userId), ne(schema.session.id, s.id)));
          const kind = method === "fallback" ? "fallback_sign_in" : method === "email-otp" ? "recovery" : "sign_in";
          await logSecurityEvent(s.userId, kind, { method }, headers);
          if (others.length && !others.some((o) => o.ua === ua)) await logSecurityEvent(s.userId, "new_device", { method }, headers);
          // The admin role follows ADMIN_EMAIL (checked on every sign-in, so changing the env moves it).
          const [u] = await db.select({ email: schema.user.email, role: schema.user.role }).from(schema.user).where(eq(schema.user.id, s.userId));
          const want = u && isAdminEmail(u.email) ? "admin" : "user";
          if (u && u.role !== want) await db.update(schema.user).set({ role: want }).where(eq(schema.user.id, s.userId));
          if (u) await ensurePersonalSpace(s.userId, firstName(null, u.email));
        },
      },
    },
  },
  plugins,
});

export type Auth = typeof auth;

/** The fallback endpoint, typed (the plugin list is built conditionally, so `auth.api` can't infer it). */
export function fallbackSignIn(opts: { body: { password: string }; headers: Headers; returnHeaders: true }): Promise<{ headers: Headers; response: unknown }> {
  return (auth.api as unknown as Record<string, (o: unknown) => Promise<{ headers: Headers; response: unknown }>>).fallbackSignIn(opts);
}
