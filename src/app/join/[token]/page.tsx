import type { Metadata } from "next";
import { headers } from "next/headers";
import { JoinFlow } from "@/components/auth/join-flow";
import "@/components/auth/nx.css";
import { testIdpEnabled } from "@/lib/auth/config";
import { requestIp } from "@/lib/auth/events";
import { hitLimit, MINUTE } from "@/lib/auth/limits";
import { getSessionUser } from "@/lib/auth/session";
import { APP_NAME } from "@/lib/brand";
import { invitePreview } from "@/lib/spaces";

export const metadata: Metadata = { title: `Join · ${APP_NAME}`, robots: { index: false, follow: false } };

// R15 C2 — Join-phone: preview (space, who invited, people, role, expiry) → join; joined; expired / dead link.
// Public (proxy allow-list: /join/*), rate-limited per IP; shows no item data, only the space's name and faces.
export default async function JoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ go?: string }> }) {
  const [{ token }, sp, h] = await Promise.all([params, searchParams, headers()]);
  const ip = requestIp(h) ?? "local";
  const allowed = await hitLimit(`join-view:${ip}`, 30, MINUTE);
  const preview = allowed ? await invitePreview(token) : ({ ok: false, problem: "invalid", inviter: null } as const);
  const signedIn = !!(await getSessionUser(h));
  // eslint-disable-next-line react-hooks/purity -- a server component renders once
  const days = preview.ok ? Math.max(1, Math.ceil((preview.expiresAt - Date.now()) / 86_400_000)) : 0;
  return (
    <div className="nx">
      <JoinFlow token={token} preview={preview} days={days} signedIn={signedIn} auto={sp.go === "1"} app={APP_NAME} provider={testIdpEnabled() ? "test-idp" : "google"} />
    </div>
  );
}
