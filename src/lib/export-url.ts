// The Excel (BOM) download for a view or a project/list (/api/export, Round 9 F1).
export function exportUrl(target: { collection?: string; view?: string }, currency: string, locale: string): string {
  const p = new URLSearchParams({ currency, locale });
  if (target.collection) p.set("collection", target.collection);
  else p.set("view", target.view ?? "to_buy");
  return `/api/export?${p}`;
}

/** Start a file download without navigating away. */
export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.click();
}
