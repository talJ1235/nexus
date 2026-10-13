// R18 S2 A2: /supermarket — the same app as "/", opened on the Supermarket tab (the evening draft push, live adds and
// "Send to phone" open here; `?draft=1` shows the draft's "Ready for …" header). Replaces S1's redirect to To buy.
import Home from "../page";

export const maxDuration = 60;

export default async function SupermarketPage() {
  return Home({ searchParams: Promise.resolve({ v: "supermarket" }) });
}
