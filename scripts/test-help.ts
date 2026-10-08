// Unit test for the assistant's app help (Round 8 D2): question routing, action links, and the help file itself —
// under 25 KB and mentioning every top-level SPEC feature.  npx tsx scripts/test-help.ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extractActions } from "../src/lib/help/links";
import { classifyQuestion } from "../src/lib/help/route";

const route = (q: string, names: string[] = []) => classifyQuestion(q, names).route;

// How to use the app → help.
for (const q of [
  "how do I add a receipt?",
  "Why is a product missing its picture?",
  "the extension says not connected",
  "How do I switch to Plum?",
  "where are the settings",
  "איך מוסיפים קבלה?",
  "התוסף לא מתחבר",
  "איך עוברים לשזיף?",
])
  assert.equal(route(q), "help", q);

// About the user's data → data.
for (const q of ["How much is left to buy?", "what did I buy last month?", "which items are urgent?", "כמה נשאר לקנות?", "מה הכי זול בפרויקט?"]) assert.equal(route(q), "data", q);
// Naming one of their projects counts as data.
assert.equal(route("anything new on Railcam?", ["Railcam"]), "data");

// Fallback: no signal, or both → the model decides with both in front of it.
assert.equal(route("hello"), "unsure");
assert.equal(route("thanks!"), "unsure");
assert.equal(route("how much did I spend, and where do I set the budget?"), "unsure");

// Complaints / bugs / ideas are flagged (→ report card).
assert.equal(classifyQuestion("shopping mode is broken").complaint, true);
assert.equal(classifyQuestion("I have an idea: dark mode per project").complaint, true);
assert.equal(classifyQuestion("זה באג, הכפתור לא עובד").complaint, true);
assert.equal(classifyQuestion("how much is left to buy?").complaint, false);

// Action links: whitelisted ones become buttons (max 3, deduped); a line that was only links disappears; unknown → text.
let a = extractActions("Open Settings → Palette.\n\n[Switch to Plum](nexus:palette/plum)\n[Open settings](nexus:settings)");
assert.deepEqual(a.actions, [
  { label: "Switch to Plum", action: "palette/plum" },
  { label: "Open settings", action: "settings" },
]);
assert.equal(a.text, "Open Settings → Palette.");
a = extractActions("Use the [receipt scanner](nexus:receipt) on your phone.");
assert.equal(a.text, "Use the receipt scanner on your phone.");
assert.deepEqual(a.actions.map((x) => x.action), ["receipt"]);
a = extractActions("[Delete everything](nexus:wipe) — no.");
assert.equal(a.actions.length, 0);
assert.equal(a.text, "Delete everything — no.");
a = extractActions(["a", "b", "c", "d"].map((k, i) => `[${k}](nexus:view/${["to_buy", "history", "orders", "spending"][i]})`).join("\n") + "\n[again](nexus:view/to_buy)");
// R14 B4: Urgent / Unsorted are To buy filters now, not pages — no longer action links.
assert.equal(extractActions("[Urgent](nexus:view/urgent)").actions.length, 0);
assert.equal(a.actions.length, 3);
assert.equal(a.text, "");

// The help topics (R17 0.2): each file small, and every top-level SPEC feature is covered by a <!-- spec: … --> marker
// in one of them.
const helpPath = "src/lib/help/topics";
const topicFiles = readdirSync(helpPath).filter((f) => f.endsWith(".md")).sort();
assert.ok(topicFiles.length >= 7, `expected the topic files in ${helpPath}`);
const TOPIC_MAX = 9_000;
let size = 0;
for (const f of topicFiles) {
  const s = statSync(`${helpPath}/${f}`).size;
  assert.ok(s < TOPIC_MAX, `${f} is ${s} bytes (max ${TOPIC_MAX}) — split the topic`);
  size += s;
}
assert.ok(size < 60_000, `help is ${size} bytes in all (max 60,000)`);
const help = topicFiles.map((f) => readFileSync(`${helpPath}/${f}`, "utf8")).join("\n\n");
const covered = new Set([...help.matchAll(/<!--\s*spec:\s*([^>]+?)\s*-->/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().toLowerCase())));
const spec = readFileSync("SPEC.md", "utf8");
// Internal / engineering entries that aren't something a user does.
const SKIP = /^(round \d|stack|environment|non-goals|core concepts|extraction pipeline \(server|research|palette "ink & teal"|one loader|add-link feedback|same link twice|cards|item sheet|dev|reading a pasted link|ai assistant\*\*$|first load|logo|phone opening animation|smoke|store identity|toasts|clicks during a slow load|motion|phone layout self-heal)/i;
const features = [
  ...[...spec.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()),
  ...[...spec.matchAll(/^- \*\*([^*]+)\*\*/gm)].map((m) => m[1].trim()),
]
  // "Telegram bot input (shipped)" → "Telegram bot input"; "Offline, read-only v1" → "Offline" (markers are comma-separated).
  // "Polish fixes (2026-10-08) — shipped" → "Polish fixes".
  .map((f) => f.replace(/\s*(\(shipped\)|— shipped)$/i, "").replace(/\s*\(\d{4}-\d\d-\d\d\)$/, "").split(",")[0].trim())
  .filter((f) => !SKIP.test(f));
const missing = features.filter((f) => !covered.has(f.toLowerCase()));
assert.deepEqual(missing, [], `SPEC features not mentioned in ${helpPath}: ${missing.join(", ")}`);

console.log(`OK help (${features.length} SPEC features covered, ${topicFiles.length} topics, ${(size / 1024).toFixed(1)} KB)`);
