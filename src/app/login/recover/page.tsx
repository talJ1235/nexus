import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import "@/components/auth/nx.css";
import { RecoverFlow } from "@/components/auth/recover-flow";
import { authMode } from "@/lib/auth/config";
import { requestHost } from "@/lib/auth/server";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `Recover · ${APP_NAME}`, robots: { index: false, follow: false } };

// R15 A2: email-code recovery — only in full mode (domain + Resend); closed-circle mode goes back to /login.
export default async function RecoverPage() {
  if (authMode(requestHost(await headers())) !== "full") redirect("/login");
  return (
    <div className="nx">
      <RecoverFlow />
    </div>
  );
}
