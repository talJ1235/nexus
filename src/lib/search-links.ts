import { STORES } from "./onboarding";
/** Store search links for items that don't have a store link yet. R17 H2: the stores picked in onboarding that have a
 *  plain search page come first. */
export function storeSearches(q: string, picked: string[] = [], he = false) {
  const e = encodeURIComponent(q.trim());
  const mine = STORES.filter((s) => s.search && picked.includes(s.id)).map((s) => ({ name: he ? s.he : s.en, url: s.search!.replace("{q}", e) }));
  return [
    ...mine,
    { name: "AliExpress", url: `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(q.trim().replace(/\s+/g, "-"))}.html` },
    { name: "Amazon", url: `https://www.amazon.com/s?k=${e}` },
    { name: "Zap", url: `https://www.zap.co.il/search.aspx?keyword=${e}` },
    { name: "Google", url: `https://www.google.com/search?tbm=shop&q=${e}` },
  ];
}
