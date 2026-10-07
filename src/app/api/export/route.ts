import ExcelJS from "exceljs";
import { type NextRequest } from "next/server";
import { activeSource, lineTotal, unitPrice } from "@/lib/calc";
import { routeCtx } from "@/lib/ctx";
import { getAppData } from "@/lib/data";
import { scoped } from "@/lib/db-scoped";
import { dictionaries, isLocale } from "@/lib/i18n";
import { CURRENCIES, type Currency } from "@/lib/money";
import { itemsForView, type View } from "@/lib/views";

// R15 B3: the current space only, owner role.
export async function GET(req: NextRequest) {
  const ctx = await routeCtx("owner");
  if (ctx instanceof Response) return ctx;
  const p = req.nextUrl.searchParams;
  const currency = ((CURRENCIES as readonly string[]).includes(p.get("currency") ?? "") ? p.get("currency") : "ILS") as Currency;
  const locale = isLocale(p.get("locale")) ? (p.get("locale") as "en" | "he") : "en";
  const t = dictionaries[locale];
  const data = await getAppData(scoped(ctx), ctx.user.id);

  let view: View = { type: "to_buy" };
  const cid = p.get("collection");
  const v = p.get("view") ?? "";
  if (cid) view = { type: "collection", id: cid };
  else if (v.startsWith("store:")) view = { type: "store", key: v.slice(6) };
  else if (v === "history") view = { type: "history" };
  // The export keeps the old view names for To buy's filters (R14 B4).
  else if (v === "urgent") view = { type: "to_buy", f: "urgent" };
  else if (v === "unsorted") view = { type: "to_buy", f: "none" };

  const collection = cid ? data.collections.find((c) => c.id === cid) : null;
  // R16 D1: Settings → Data → Export items = every item in the space.
  const all = !cid && v === "all";
  const items = all ? data.items : itemsForView(data.items, view);
  const title =
    collection?.name ??
    (all ? "Nexus" : null) ??
    (view.type === "store" ? view.key : view.type === "collection" ? "Nexus" : view.type === "history" ? t.nav.history : view.type === "to_buy" && view.f ? (view.f === "urgent" ? t.nav.urgent : t.nav.unsorted) : t.nav.toBuy);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Nexus";
  const ws = wb.addWorksheet(title.slice(0, 31).replace(/[\\/*?:[\]]/g, " "), {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: locale === "he" }],
  });
  const pr = { urgent: t.item.urgent, normal: t.item.normal, someday: t.item.someday };
  ws.columns = [
    { header: "#", key: "n", width: 5 },
    { header: t.table.item, key: "title", width: 48 },
    { header: t.table.qty, key: "qty", width: 7 },
    { header: `${t.table.price} (${currency})`, key: "unit", width: 16, style: { numFmt: "#,##0.00" } },
    { header: `${t.table.total} (${currency})`, key: "total", width: 16, style: { numFmt: "#,##0.00" } },
    { header: t.table.store, key: "store", width: 16 },
    { header: "Link", key: "link", width: 40 },
    { header: t.table.priority, key: "priority", width: 11 },
    { header: t.table.collection, key: "collection", width: 18 },
    { header: t.item.tags, key: "tags", width: 22 },
    { header: t.item.notes, key: "notes", width: 36 },
    { header: "Status", key: "status", width: 12 },
  ];
  items.forEach((i, idx) => {
    const src = activeSource(i, data.rates);
    const row = ws.addRow({
      n: idx + 1,
      title: i.title,
      qty: i.quantity,
      unit: unitPrice(i, data.rates, currency),
      total: lineTotal(i, data.rates, currency),
      store: src?.store ?? "",
      link: src?.url ? { text: src.url, hyperlink: src.url } : "",
      priority: pr[i.priority],
      collection: data.collections.find((c) => c.id === i.collectionId)?.name ?? "",
      tags: (i.tags ?? []).join(", "),
      notes: i.notes ?? "",
      status: i.status === "purchased" ? t.nav.history : t.nav.toBuy,
    });
    row.getCell("link").font = { color: { argb: "FF2F6FD6" }, underline: true };
  });
  const last = items.length + 1;
  const totalRow = ws.addRow({ title: t.item.total, qty: { formula: `SUM(C2:C${last})` }, total: { formula: `SUM(E2:E${last})` } });
  totalRow.font = { bold: true };
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF14A898" } };
  ws.autoFilter = { from: "A1", to: `L${Math.max(1, last)}` };

  const buf = await wb.xlsx.writeBuffer();
  const filename = `nexus-${title.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(buf, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
