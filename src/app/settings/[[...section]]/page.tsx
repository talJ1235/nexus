// R16 D1: deep links into Settings (/settings, /settings/display, /settings/people, …). The same app as "/"; the
// settings shell reads the section from the URL and opens over it (the old /settings/security and /settings/invites
// pages are sections now: Account & security, Account → Invite codes). R17 A3: the section goes into the app's boot, so
// the shell is there from the first paint (the streamed loading shell included) — never a frame of Home first.
import Home from "../../page";

export const maxDuration = 60;

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ section?: string[] }>; searchParams: Promise<{ v?: string; f?: string }> }) {
  const { section } = await params;
  const raw = (section?.[0] ?? "").slice(0, 40);
  return Home({ searchParams, settings: raw === "security" ? "account" : raw });
}
