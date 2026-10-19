// R19 A8 — the assistant's inline markup: Tal's report r_mvWUA_ddri (a bold lead with [[id]] refs and a 43" screen
// rendered as one chip with the raw brackets) + figures, money, streaming. npm run test:chat-inline
import assert from "node:assert/strict";
import { chatRefs, chatTokens, isFigure, type ChatTok } from "../src/lib/chat-inline";

const texts = (ts: ChatTok[]): string[] => ts.flatMap((t) => (t.k === "bold" ? texts(t.parts) : t.k === "ref" ? [] : [t.v]));
const refs = (ts: ChatTok[]): string[] => ts.flatMap((t) => (t.k === "bold" ? refs(t.parts) : t.k === "ref" ? [t.id] : []));

// The reported answer (he), verbatim.
const reported =
  '**מ־Machsanei Hashmal כדאי להזמין את מסך ה־43" LG [[nx4Z8k5uxe-P]] ואת מקרר מקפיא עליון Electra [[h5pPbrt7puRe]], שכבר ממתינים ברשימת הרכישות.**';
const t1 = chatTokens(reported);
assert.equal(t1.length, 1);
assert.equal(t1[0].k, "bold", "a bold sentence stays bold text, not a chip");
assert.deepEqual(refs(t1), ["nx4Z8k5uxe-P", "h5pPbrt7puRe"], "references inside bold are parsed");
assert.ok(texts(t1).every((v) => !v.includes("[[") && !v.includes("]]")), "no raw brackets reach the screen");
assert.ok(texts(t1).join("").includes('43" LG'));
assert.deepEqual(chatRefs(reported), ["nx4Z8k5uxe-P", "h5pPbrt7puRe"]);

// The list lines of the same answer: name, ref, money.
const line = "מקרר מקפיא עליון 206 ליטר Electra EL217N [[h5pPbrt7puRe]] בעלות של ‏799 ‏₪.";
const t2 = chatTokens(line);
assert.deepEqual(refs(t2), ["h5pPbrt7puRe"]);
assert.ok(texts(t2).every((v) => !v.includes("[[")));

// Figures stay chips; sentences don't.
assert.ok(isFigure("₪1,450") && isFigure("8 items") && isFigure("3 of 9"));
assert.ok(!isFigure('the 43" LG screen and the fridge') && !isFigure("Electra [[h5pPbrt7puRe]]") && !isFigure("no digits"));
assert.deepEqual(chatTokens("You have **8 items** left").map((t) => t.k), ["text", "figure", "text"]);
// Money in plain text and inside bold.
assert.deepEqual(chatTokens("Total ₪1,234.90 today").map((t) => t.k), ["text", "money", "text"]);
const t3 = chatTokens("**Spend about ₪120 on the fridge parts**");
assert.equal(t3[0].k, "bold");
assert.ok(t3[0].k === "bold" && t3[0].parts.some((p) => p.k === "money" && p.v === "₪120"));

// Streaming: a half-written reference / bold at the end is held back.
assert.ok(texts(chatTokens("Buy the fridge [[h5pP", true)).every((v) => !v.includes("[[")));
assert.ok(texts(chatTokens("Buy the fridge [[h5pPbrt7puRe]", true)).every((v) => !v.includes("[[")));
assert.ok(texts(chatTokens("So **the main", true)).every((v) => !v.includes("**")));
assert.deepEqual(refs(chatTokens("A [[h5pPbrt7puRe]] b", true)), ["h5pPbrt7puRe"]);

console.log("OK test:chat-inline (the reported bold lead, figures vs sentences, money, streaming)");
