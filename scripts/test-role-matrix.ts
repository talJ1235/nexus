// R15 B3 guard 4 (SECURITY.md §4): owner / member / viewer / outsider / signed-out / banned × each action group →
// expected allow / deny. Pure parts run directly (allows, pickSpace); the action table is read from the source, so a
// new write action that only asks for "view" fails here.   npx tsx --conditions=react-server scripts/test-role-matrix.ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { allows, pickSpace, type Need } from "../src/lib/ctx";
import type { Membership } from "../src/lib/spaces";

type Who = "owner" | "member" | "viewer" | "outsider" | "signed-out" | "banned";
const WHO: Who[] = ["owner", "member", "viewer", "outsider", "signed-out", "banned"];
// What each caller can do in space A. Outsiders act in their own personal space (pickSpace), never A; signed-out and
// banned callers have no session (getSessionUser → null → "unauthorized").
const EXPECT: Record<Need, Record<Who, boolean>> = {
  view: { owner: true, member: true, viewer: true, outsider: false, "signed-out": false, banned: false },
  edit: { owner: true, member: true, viewer: false, outsider: false, "signed-out": false, banned: false },
  owner: { owner: true, member: false, viewer: false, outsider: false, "signed-out": false, banned: false },
};

const A: Membership = { spaceId: "A", role: "owner", name: "A", kind: "shared", color: "plum", icon: "home", currency: "ILS" };
const mine = (role: Membership["role"]): Membership[] => [
  { spaceId: "P", role: "owner", name: "me", kind: "personal", color: "plum", icon: "user", currency: "ILS" },
  { ...A, role },
];
function canInA(who: Who, need: Need) {
  if (who === "signed-out" || who === "banned") return false;
  const ms = who === "outsider" ? mine("owner").slice(0, 1) : mine(who);
  const m = pickSpace(ms, "A");
  return !!m && m.spaceId === "A" && allows(m.role, need);
}
let n = 0;
for (const need of ["view", "edit", "owner"] as Need[])
  for (const who of WHO) {
    assert.equal(canInA(who, need), EXPECT[need][who], `${who} × ${need}`);
    n++;
  }

// Cookie handling: a forged / foreign / missing space id falls back to the personal space.
assert.equal(pickSpace(mine("viewer"), "not-mine")?.spaceId, "P");
assert.equal(pickSpace(mine("viewer"), undefined)?.spaceId, "P");
assert.equal(pickSpace(mine("viewer"), "A")?.role, "viewer");

// Action groups: which actions a viewer may call (reads + their own personal things). Everything else must ask for
// "edit" or "owner", so a viewer's write is refused before any query.
const VIEW_OK = new Set([
  "actions.ts#reloadAll",
  "ai-actions.ts#ask",
  "alert-actions.ts#getAlertsState", "alert-actions.ts#saveAlertPrefs", "alert-actions.ts#gone",
  "alert-actions.ts#tgSaveToken", "alert-actions.ts#tgFinishLink", "alert-actions.ts#tgDisconnect", "alert-actions.ts#tgTest",
  "barcode-actions.ts#lookupBarcode",
  "cal-actions.ts#calendarInfo", "cal-actions.ts#regenerateCalendar", "cal-actions.ts#markCalendarSubscribed", "cal-actions.ts#calendarSubscribed",
  "chat-actions.ts#me",
  "compare-actions.ts#compareStart", "compare-actions.ts#compareVerify",
  "guest-actions.ts#gone",
  "home-actions.ts#dismissHome", "home-actions.ts#undismissHome", "home-actions.ts#setAiSuggestions", "home-actions.ts#phraseSuggestions", "home-actions.ts#homeLook", "home-actions.ts#homeDiag",
  "memory-actions.ts#getMemoryState", "memory-actions.ts#setMemoryEnabled", "memory-actions.ts#saveMemoryNote", "memory-actions.ts#updateMemoryNote", "memory-actions.ts#deleteMemoryNote",
  "picture-actions.ts#understandReceiptLines", "picture-actions.ts#findLinePictures", "picture-actions.ts#searchPictures", "picture-actions.ts#pictureIcons", "picture-actions.ts#itemPictureChoices", "picture-actions.ts#pictureSearchStatus",
  "receipt-actions.ts#listReceipts",
  "report-actions.ts#createReport", "report-actions.ts#listReports", "report-actions.ts#setReportStatus",
  "share-actions.ts#getSharing",
  "security-actions.ts#*", "invite-admin-actions.ts#*",
  // Spaces: switching, creating your own, reading people, leaving, restoring, joining by link; moving back checks
  // the edit role in both spaces itself. Everything else in space-actions asks for "edit" or "owner".
  "space-actions.ts#switchSpace", "space-actions.ts#createSpace", "space-actions.ts#getSpacePeople", "space-actions.ts#leaveCurrentSpace",
  "space-actions.ts#restoreDeletedSpace", "space-actions.ts#joinSpace", "space-actions.ts#moveCollectionBack",
  "actions.ts#view",
]);
const dir = join(__dirname, "..", "src", "app");
const viewUses: string[] = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith("-actions.ts") || x === "actions.ts")) {
  const text = readFileSync(join(dir, f), "utf8");
  // Every function (exported or helper) and the need it asks for.
  const re = /(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=\s*async)[^]*?requireCtx\("(view|edit|owner)"\)/g;
  for (const m of text.matchAll(re)) {
    const name = m[1] ?? m[2];
    // The match may span functions; take the nearest declaration before the requireCtx call.
    const upto = text.slice(0, (m.index ?? 0) + m[0].length);
    const decls = [...upto.matchAll(/(?:function\s+(\w+)|const\s+(\w+)\s*=\s*async)/g)];
    const nearest = decls.at(-1);
    const fn = nearest ? (nearest[1] ?? nearest[2]) : name;
    if (m[3] === "view" && !VIEW_OK.has(`${f}#${fn}`) && !VIEW_OK.has(`${f}#*`)) viewUses.push(`${f}#${fn}`);
  }
}
assert.deepEqual(viewUses, [], `actions a viewer could call without being on the read list: ${viewUses.join(", ")}`);
console.log(`OK role matrix: ${n} role × need cases, cookie fallback, viewer-callable actions limited to the read list`);
