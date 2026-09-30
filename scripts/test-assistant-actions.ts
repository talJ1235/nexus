// Unit test for src/lib/assistant-actions.ts (parser/validator + planned changes).  npx tsx scripts/test-assistant-actions.ts
import assert from "node:assert/strict";
import { parseAnswer, planChanges, splitAnswer, validateProposal } from "../src/lib/assistant-actions";
import type { ItemWithSources } from "../src/lib/types";

const ctx = { itemIds: new Set(["fan001", "motor01", "belt001"]), collectionIds: new Set(["rail01"]) };
const block = (json: string) => `Sure — here's the change.\n\n\`\`\`nexus-actions\n${json}\n\`\`\``;

// Valid: text keeps the answer, block is stripped, proposal validated.
{
  const r = parseAnswer(block(`{"summary":"Mark 2 Railcam parts as ordered","actions":[{"type":"setStatus","itemIds":["fan001","motor01","fan001"],"status":"ordered"}]}`), ctx);
  assert.equal(r.text, "Sure — here's the change.");
  assert.equal(r.proposal?.summary, "Mark 2 Railcam parts as ordered");
  assert.deepEqual(r.proposal?.actions[0], { type: "setStatus", itemIds: ["fan001", "motor01"], status: "ordered" });
}
// New collection + move to it by ref; unknown extra keys are ignored.
{
  const p = validateProposal({ summary: "New project", actions: [{ type: "createCollection", ref: "n1", name: "Drone", kind: "project", why: "x" }, { type: "move", itemIds: ["belt001"], collectionId: "new:n1" }] }, ctx);
  assert.ok(p);
  assert.equal(validateProposal({ summary: "x", actions: [{ type: "move", itemIds: ["belt001"], collectionId: "new:nope" }] }, ctx), null);
  assert.ok(validateProposal({ summary: "x", actions: [{ type: "move", itemIds: ["belt001"], collectionId: null }] }, ctx), "move to Unsorted");
}
// Unknown action (incl. delete) → dropped, text still shows.
{
  const r = parseAnswer(block(`{"summary":"Delete it","actions":[{"type":"delete","itemIds":["fan001"]}]}`), ctx);
  assert.equal(r.proposal, null);
  assert.equal(r.text, "Sure — here's the change.");
}
// Foreign item id or project id → dropped.
assert.equal(validateProposal({ summary: "x", actions: [{ type: "setPriority", itemIds: ["fan001", "someone"], priority: "urgent" }] }, ctx), null);
assert.equal(validateProposal({ summary: "x", actions: [{ type: "move", itemIds: ["fan001"], collectionId: "other" }] }, ctx), null);
// More than 50 items → dropped (per action and across actions).
{
  const many = Array.from({ length: 60 }, (_, i) => `id${i}`);
  const big = { itemIds: new Set(many), collectionIds: new Set<string>() };
  assert.equal(validateProposal({ summary: "x", actions: [{ type: "setQty", itemIds: many, qty: 2 }] }, big), null);
  assert.equal(validateProposal({ summary: "x", actions: [{ type: "setQty", itemIds: many.slice(0, 30), qty: 2 }, { type: "addTag", itemIds: many.slice(30), tag: "x" }] }, big), null);
  assert.ok(validateProposal({ summary: "x", actions: [{ type: "setQty", itemIds: many.slice(0, 50), qty: 2 }] }, big));
}
// Malformed JSON / bad values → dropped; no block → no proposal.
assert.equal(parseAnswer(block(`{"summary":"x","actions":[{"type":"setQty",`), ctx).proposal, null);
assert.equal(validateProposal({ summary: "x", actions: [{ type: "setQty", itemIds: ["fan001"], qty: 0 }] }, ctx), null);
assert.equal(validateProposal({ summary: "x", actions: [{ type: "setStatus", itemIds: ["fan001"], status: "deleted" }] }, ctx), null);
assert.equal(validateProposal({ summary: "", actions: [] }, ctx), null);
assert.deepEqual(splitAnswer("Just an answer."), { text: "Just an answer.", raw: null });
// Unterminated block (answer cut off) is still stripped from the text.
assert.equal(splitAnswer("Ok.\n```nexus-actions\n{\"summary\":").text, "Ok.");

// planChanges: before → after, no-ops left out, tags case-insensitive.
{
  const item = (id: string, p: Partial<ItemWithSources>) => ({ id, title: id, status: "to_buy", priority: "normal", quantity: 1, collectionId: null, tags: ["esp32"], ...p }) as ItemWithSources;
  const items = [item("fan001", {}), item("motor01", { status: "ordered" })];
  const p = validateProposal({ summary: "x", actions: [
    { type: "setStatus", itemIds: ["fan001", "motor01"], status: "ordered" },
    { type: "setPriority", itemIds: ["fan001"], priority: "urgent" },
    { type: "setQty", itemIds: ["fan001"], qty: 2 },
    { type: "addTag", itemIds: ["motor01"], tag: "ESP32" },
  ] }, ctx)!;
  const ch = planChanges(p, items);
  assert.equal(ch.length, 1, "motor01 ends up unchanged");
  assert.deepEqual(ch[0].before, { collectionId: null, status: "to_buy", priority: "normal", quantity: 1, tags: ["esp32"] });
  assert.deepEqual(ch[0].after, { collectionId: null, status: "ordered", priority: "urgent", quantity: 2, tags: ["esp32"] });
  const rm = validateProposal({ summary: "x", actions: [{ type: "removeTag", itemIds: ["fan001"], tag: "Esp32" }] }, ctx)!;
  assert.deepEqual(planChanges(rm, items)[0].after.tags, []);
}

console.log("OK assistant-actions");
