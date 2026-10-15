import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DebugCamera } from "@/components/app/supermarket/debug-camera";
import { APP_NAME } from "@/lib/brand";
import { currentCtx, isAdmin } from "@/lib/ctx";

export const metadata: Metadata = { title: `Camera · ${APP_NAME}`, robots: { index: false, follow: false } };

// R18 S4 B2: what the scanner's camera is on this phone — the chosen lens and how, its settings and capabilities
// (focusMode, zoom, torch, resolution), every video input, and the decoder in use. The admin only (a screenshot for Tal).
export default async function DebugCameraPage() {
  const ctx = await currentCtx();
  if (!ctx) redirect("/login?next=/debug/camera");
  if (!isAdmin(ctx)) notFound();
  return <DebugCamera />;
}
