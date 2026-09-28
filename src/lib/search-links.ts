/** Store search links for items that don't have a store link yet. */
export function storeSearches(q: string) {
  const e = encodeURIComponent(q.trim());
  return [
    { name: "AliExpress", url: `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(q.trim().replace(/\s+/g, "-"))}.html` },
    { name: "Amazon", url: `https://www.amazon.com/s?k=${e}` },
    { name: "Zap", url: `https://www.zap.co.il/search.aspx?keyword=${e}` },
    { name: "Google", url: `https://www.google.com/search?tbm=shop&q=${e}` },
  ];
}
