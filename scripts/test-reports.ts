// Unit test for src/lib/reports.ts (problem reports, Round 8 D3).  npx tsx scripts/test-reports.ts
import assert from "node:assert/strict";
import { parseReportBlock, reportBody, reportMarkdown, reportTitle, type ReportRow } from "../src/lib/reports";

// Body: filled sections only, in order.
const body = reportBody({ type: "bug", title: "Totals wrong", happened: "The total shows ₪0", steps: "1. Open home", expected: "", actual: "  " });
assert.equal(body, "**What happened**\nThe total shows ₪0\n\n**Steps**\n1. Open home");

// Markdown for Claude Code: title, status, body, diagnostics, errors, the assistant exchange; fences can't break out.
const row: ReportRow = {
  id: "r_123",
  type: "bug",
  title: "Totals wrong",
  body,
  status: "open",
  githubIssue: 42,
  createdAt: Date.UTC(2026, 9, 1, 12, 30),
  updatedAt: Date.UTC(2026, 9, 1, 12, 30),
  diagnostics: {
    client: { view: "to_buy", device: "phone", viewport: "390×844", palette: "plum", mode: "dark", locale: "he", online: true, extension: null, version: "abc123", errors: [{ at: Date.UTC(2026, 9, 1, 12, 29, 5), kind: "toast", message: "Something went wrong ```" }] },
    server: { commit: "abc123def456", aiProviders: ["gemini"], blob: true, telegram: false },
    assistant: { question: "why is the total 0?", answer: "Looks like a bug." },
    screenshot: true,
  },
};
const md = reportMarkdown(row);
for (const part of [
  "## Bug: Totals wrong",
  "`r_123` · open · 2026-10-01 12:30 UTC · GitHub #42",
  "**What happened**\nThe total shows ₪0",
  "- View: to_buy · phone · viewport 390×844",
  "- Theme: plum dark · locale he · online",
  "- App version: abc123def456 · extension: not detected",
  "- Server: AI gemini · Blob yes · Telegram no",
  "- Screenshot: attached in the app (Reports)",
  "**Last 1 client errors**",
  "12:29:05 toast: Something went wrong ʼʼʼ",
  "> why is the total 0?",
])
  assert.ok(md.includes(part), `markdown misses: ${part}\n---\n${md}`);
assert.equal(md.split("```").length - 1, 2, "only the errors block is fenced");
// No diagnostics at all still renders.
assert.ok(reportMarkdown({ ...row, diagnostics: null, githubIssue: null, body: "" }).includes("_(no description)_"));

// The assistant's drafted report block.
const ans = 'Sorry — that looks like a bug. Here is a report you can send.\n\n```nexus-report\n{"type":"bug","title":"Shopping mode loses checks","happened":"Checked items came back","steps":"1. Check 3 items\\n2. Lock the phone","expected":"Still checked","actual":"Unchecked"}\n```';
const p = parseReportBlock(ans);
assert.equal(p.text, "Sorry — that looks like a bug. Here is a report you can send.");
assert.equal(p.report?.title, "Shopping mode loses checks");
assert.equal(p.report?.steps, "1. Check 3 items\n2. Lock the phone");
// Unknown type → bug; no title or bad JSON → no card (text kept).
assert.equal(parseReportBlock('```nexus-report\n{"type":"rant","title":"x"}\n```').report?.type, "bug");
assert.equal(parseReportBlock('ok\n```nexus-report\n{"type":"idea"}\n```').report, null);
assert.equal(parseReportBlock("ok\n```nexus-report\nnot json\n```").text, "ok");
assert.equal(parseReportBlock("no block").report, null);

// R9 D1 — the title comes from the one text box: first sentence or line, ≤ 80 chars cut at a word.
assert.equal(reportTitle("The total shows zero. It should be 1,200."), "The total shows zero.");
assert.equal(reportTitle("Shopping mode loses my checks\nwhen I lock the phone"), "Shopping mode loses my checks");
const long = reportTitle("When I open the receipt camera on my phone the outline keeps jumping around and never settles on anything useful");
assert.ok(long.length <= 80 && long.endsWith("…") && !long.includes("  "), long);
assert.equal(reportTitle("   "), "Report");

// R9 D1 — the extra diagnostics appear in the markdown (and old reports without them still render).
const md2 = reportMarkdown({
  ...row,
  diagnostics: {
    ...(row.diagnostics as object),
    client: {
      ...(row.diagnostics as { client: object }).client,
      nav: ["to_buy", "ordered", "projects"],
      viewCount: 12,
      network: { type: "4g" },
      hw: { memory: 8, cores: 8 },
      sw: "abc123",
      failed: [{ at: 1, path: "/api/ask", status: 500 }, { at: 2, path: "/", status: 0 }],
    },
  },
});
for (const part of ["- Last views: to_buy → ordered → projects", "- Items in the view: 12", "- Device: network 4g · 8 GB · 8 cores", "- Service worker: abc123", "- Failed requests: /api/ask 500, / network"]) assert.ok(md2.includes(part), `markdown misses: ${part}`);
assert.ok(!md.includes("Last views"));

console.log("OK reports");
