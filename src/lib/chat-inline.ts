// R19 A8 — the assistant's inline markup, parsed once (pure: test:chat-inline). `**bold**`, `[[itemId]]` references and
// money amounts. A bold run is a chip only when it is a short figure ("₪1,450", "8 items"); a bold sentence stays text
// and its references / amounts are parsed inside it (Tal's report r_mvWUA_ddri: a bold lead with two [[id]] refs and a
// 43" screen came out as one grey chip with the raw "[[h5pPbrt7puRe]]" in it). A half-written reference at the end of
// a streaming answer ("[[h5pP") is held back until it closes.

export type ChatTok =
  | { k: "text"; v: string }
  | { k: "money"; v: string }
  | { k: "figure"; v: string }
  | { k: "ref"; id: string }
  | { k: "bold"; parts: ChatTok[] };

const REF = /(\[\[[\w-]{6,24}\]\])/g;
const MONEY = /([₪$€]\s?\d[\d,.]*|\d[\d,.]*\s?[₪$€])/;
const MONEY_G = /([₪$€]\s?\d[\d,.]*|\d[\d,.]*\s?[₪$€])/g;

/** A short figure in bold — a number with at most two words around it, no reference, ≤ 24 characters. */
export function isFigure(inner: string) {
  const v = inner.trim();
  return v.length > 0 && v.length <= 24 && /\d/.test(v) && !v.includes("[[") && v.split(/\s+/).length <= 3;
}

function flat(text: string): ChatTok[] {
  const out: ChatTok[] = [];
  for (const p of text.split(REF)) {
    if (!p) continue;
    const m = p.match(/^\[\[([\w-]{6,24})\]\]$/);
    if (m) {
      out.push({ k: "ref", id: m[1] });
      continue;
    }
    for (const q of p.split(MONEY_G)) {
      if (!q) continue;
      if (MONEY.test(q) && /^[₪$€\d]/.test(q.trim())) out.push({ k: "money", v: q.trim() });
      else out.push({ k: "text", v: q });
    }
  }
  return out;
}

export function chatTokens(text: string, streaming = false): ChatTok[] {
  // Streaming: an unclosed reference / bold at the very end waits for the rest.
  let src = text;
  if (streaming) src = src.replace(/\[\[[\w-]{0,24}\]?$/, "").replace(/\*\*[^*]*$/, (m) => m.slice(2));
  const out: ChatTok[] = [];
  for (const p of src.split(/(\*\*[^*]+\*\*)/g)) {
    if (!p) continue;
    const b = p.match(/^\*\*([^*]+)\*\*$/);
    if (!b) out.push(...flat(p));
    else if (isFigure(b[1])) out.push({ k: "figure", v: b[1].trim() });
    else out.push({ k: "bold", parts: flat(b[1]) });
  }
  return out;
}

/** Every reference in the text (bold or not), in order, once. */
export function chatRefs(text: string): string[] {
  return [...new Set([...text.matchAll(/\[\[([\w-]{6,24})\]\]/g)].map((m) => m[1]))];
}
