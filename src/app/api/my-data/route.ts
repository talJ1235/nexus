import ExcelJS from "exceljs";
import { type NextRequest } from "next/server";
import { routeCtx } from "@/lib/ctx";
import { exportMyData } from "@/lib/db-scoped/account";

export const maxDuration = 60;

// R17 E4 — "Download my data": the spaces this person owns (everything in them) + their own chats and memory.
// ?format=json (default) | xlsx (one sheet of items per owned space, plus Memory). Nobody else's data.
export async function GET(req: NextRequest) {
  const ctx = await routeCtx("view");
  if (ctx instanceof Response) return ctx;
  const data = await exportMyData(ctx.user.id);
  const day = new Date().toISOString().slice(0, 10);
  if (req.nextUrl.searchParams.get("format") !== "xlsx")
    return new Response(JSON.stringify(data, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="nexus-my-data-${day}.json"`, "cache-control": "no-store" } });
  const wb = new ExcelJS.Workbook();
  for (const sp of data.spaces) {
    const ws = wb.addWorksheet(sp.name.replace(/[\/?*[\]:]/g, " ").slice(0, 31) || "Space");
    ws.columns = [
      { header: "Title", key: "title", width: 48 },
      { header: "Status", key: "status", width: 12 },
      { header: "Quantity", key: "quantity", width: 10 },
      { header: "List / project", key: "list", width: 24 },
      { header: "Store", key: "store", width: 20 },
      { header: "Price", key: "price", width: 12 },
      { header: "Currency", key: "currency", width: 10 },
      { header: "Link", key: "url", width: 50 },
      { header: "Added", key: "created", width: 20 },
    ];
    const d = sp.data as Record<string, Record<string, unknown>[]>;
    const lists = new Map((d.collections ?? []).map((c) => [c.id, c.name]));
    for (const it of d.items ?? []) {
      const src = (d.sources ?? []).find((s) => s.itemId === it.id);
      ws.addRow({ title: it.title, status: it.status, quantity: it.quantity, list: lists.get(it.collectionId) ?? "", store: src?.store ?? "", price: src?.price ?? it.purchasedPrice ?? null, currency: src?.currency ?? it.purchasedCurrency ?? "", url: src?.url ?? "", created: it.createdAt ? new Date(Number(it.createdAt)).toISOString() : "" });
    }
  }
  const mem = wb.addWorksheet("Memory");
  mem.columns = [{ header: "Note", key: "text", width: 80 }, { header: "Saved", key: "at", width: 22 }];
  for (const m of data.memories as Record<string, unknown>[]) mem.addRow({ text: m.text ?? m.content ?? "", at: m.createdAt ? new Date(Number(m.createdAt)).toISOString() : "" });
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="nexus-my-data-${day}.xlsx"`, "cache-control": "no-store" } });
}
