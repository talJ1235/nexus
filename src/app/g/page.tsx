import type { Metadata } from "next";
import { GuestNoticePage } from "@/lib/guest-notice";

export const metadata: Metadata = { title: "Nexus", robots: { index: false, follow: false } };

// R15 D1: the guest app is retired — shared access needs an account now (GuestNotice-phone).
export default function GuestPage() {
  return <GuestNoticePage />;
}
