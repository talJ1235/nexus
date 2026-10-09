// R17 S3 K2: /inbox — the same app as "/", with the inbox open from the first paint (a phone page, the popover on a
// computer). A grouped push ("3 updates") opens here.
import Home from "../page";

export const maxDuration = 60;

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ v?: string; f?: string }> }) {
  return Home({ searchParams, inbox: true });
}
