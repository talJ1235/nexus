import "server-only";
import ExcelJS from "exceljs";

export type ParsedSheet = { columns: string[]; rows: string[][]; total: number };

const MAX_ROWS = 1000;

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("hyperlink" in v && v.hyperlink) return String(v.hyperlink);
    if ("text" in v && v.text != null) return String(typeof v.text === "object" ? JSON.stringify(v.text) : v.text);
    if ("result" in v) return v.result == null ? "" : String(v.result);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF, BOM, ; or , or tab). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export async function parseUpload(name: string, buf: ArrayBuffer): Promise<ParsedSheet> {
  let grid: string[][];
  if (/\.xlsx$/i.test(name)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
    if (!ws) return { columns: [], rows: [], total: 0 };
    grid = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals: string[] = [];
      for (let c = 1; c <= ws.actualColumnCount; c++) vals.push(cellText(r.getCell(c).value).trim());
      if (vals.some(Boolean)) grid.push(vals);
    });
  } else {
    grid = parseCsv(new TextDecoder("utf-8").decode(buf));
  }
  if (!grid.length) return { columns: [], rows: [], total: 0 };
  const width = Math.max(...grid.map((r) => r.length));
  const norm = grid.map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim()));
  const [header, ...rest] = norm;
  // If the "header" row is actually data (e.g. starts with a URL), synthesize column names.
  const looksLikeData = header.some((h) => /^https?:\/\//i.test(h));
  const columns = looksLikeData ? header.map((_, i) => `Column ${i + 1}`) : header.map((h, i) => h || `Column ${i + 1}`);
  const body = looksLikeData ? norm : rest;
  return { columns, rows: body.slice(0, MAX_ROWS), total: body.length };
}
