import type { Metadata } from "next";
import { LegalStub } from "@/components/auth/legal-stub";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: APP_NAME, robots: { index: false, follow: false } };

export default function Page() {
  return <LegalStub kind="privacy" />;
}
