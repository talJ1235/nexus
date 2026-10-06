import type { Metadata } from "next";
import { GuestNoticePage } from "@/lib/guest-notice";

export const metadata: Metadata = { title: "Nexus", robots: { index: false, follow: false } };

// R15 D1: old per-list invite links no longer work — sharing is per space, with accounts (GuestNotice-phone).
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  return <GuestNoticePage token={(await params).token} />;
}
