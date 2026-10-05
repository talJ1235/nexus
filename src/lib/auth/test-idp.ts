import "server-only";
import { testIdpEnabled } from "./config";
import { signValue, verifyValue } from "./crypto";

// Test-only OIDC stub (R15 A1 acceptance): a fake "Google" for localhost smokes. Enabled only when AUTH_TEST_IDP=1
// and NODE_ENV !== "production" (next.config.ts refuses a production build/server with it on). The "code" and the
// access token are signed blobs carrying the email the test typed; there is no password.
export const enabled = () => testIdpEnabled();
export const notFound = () => new Response("Not found", { status: 404 });
export const issue = (email: string, name: string) => signValue({ email, name }, 5 * 60_000);
export const read = (v: string | null | undefined) => verifyValue<{ email: string; name: string }>(v ?? "");
