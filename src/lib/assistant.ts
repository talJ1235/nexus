import "server-only";
import { CATEGORIES, CATEGORY_HINT, generateJson, generateText } from "./ai";
import { normalizeCategory } from "./categories";
import { ACTION_FENCE, MAX_ACTION_ITEMS } from "./assistant-actions";
import { budgetStats, lineTotal, unitPrice } from "./calc";
import { convert, formatMoney, type Rates } from "./money";
import type { AppData } from "./types";

// ---------- Project planner ----------

export type PlannedPart = {
  name: string;
  qty: number;
  spec: string;
  estMin: number | null;
  estMax: number | null;
  category: string;
  essential: boolean;
  searchQuery: string;
  have: boolean;
};

export type Plan = { projectName: string; summary: string; parts: PlannedPart[]; tips: string[]; currency: string };

export async function planProject(input: {
  description: string;
  budget: number | null;
  currency: string;
  locale: "en" | "he";
  existing: string[];
}): Promise<Plan | null> {
  if (mockAi()) return MOCK_PLAN(input.currency);
  const lang = input.locale === "he" ? "Hebrew" : "English";
  const prompt = `You help a maker plan purchases for a project. The user has a strong electronics/mechatronics background, owns a 3D printer and common hand tools, and shops mostly on AliExpress plus Israeli stores (KSP, Ivory, Bug, local maker shops).

Project description:
"""${input.description.slice(0, 3000)}"""
${input.budget ? `Budget: about ${input.budget} ${input.currency}.` : "No budget given."}
${input.existing.length ? `Already on their list for this project (do NOT repeat; mark "have": true only if you would have listed it): ${input.existing.slice(0, 80).join("; ")}` : ""}

Return a practical bill of materials to BUY (not tools they certainly own, not things they can 3D print — mention printable parts in tips instead).
Rules:
- 5–25 parts, grouped logically (motion, electronics, power, fasteners, …) and ordered by importance.
- "name": short concrete part name with the key spec (e.g. "NEMA 17 stepper motor 42-40, 1.5A"). Write names in ${lang}, but keep part numbers, units and technical terms in their original Latin form.
- "qty": realistic quantity.
- "spec": one short line on what to look for / why (in ${lang}).
- "estMin"/"estMax": realistic per-unit price range in ${input.currency} from AliExpress-level pricing (null if you really can't tell). Never inflate.
- "category": one of ${CATEGORIES.join(", ")}. ${CATEGORY_HINT}
- "essential": false for nice-to-have upgrades.
- "searchQuery": the best short ENGLISH search query to find this exact part on AliExpress/Amazon.
- "tips": 2–5 short practical tips in ${lang} (what to 3D print, what to buy as a kit, common pitfalls).
- "projectName": short name for the project (in ${lang}); "summary": one sentence (in ${lang}).`;

  const schema = {
    type: "object",
    properties: {
      projectName: { type: "string" },
      summary: { type: "string" },
      parts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            qty: { type: "integer" },
            spec: { type: "string" },
            estMin: { type: ["number", "null"] },
            estMax: { type: ["number", "null"] },
            category: { type: "string" },
            essential: { type: "boolean" },
            searchQuery: { type: "string" },
            have: { type: "boolean" },
          },
          required: ["name", "qty", "spec", "estMin", "estMax", "category", "essential", "searchQuery", "have"],
        },
      },
      tips: { type: "array", items: { type: "string" } },
    },
    required: ["projectName", "summary", "parts", "tips"],
  };
  const out = await generateJson<Omit<Plan, "currency">>(prompt, schema, { smart: true });
  if (!out?.parts?.length) return null;
  return {
    projectName: (out.projectName || "").slice(0, 80),
    summary: (out.summary || "").slice(0, 400),
    tips: (out.tips ?? []).slice(0, 6).map((t) => t.slice(0, 300)),
    currency: input.currency,
    parts: out.parts.slice(0, 30).map((p) => ({
      name: (p.name || "").slice(0, 200),
      qty: Math.max(1, Math.min(1000, Math.round(p.qty || 1))),
      spec: (p.spec || "").slice(0, 300),
      estMin: typeof p.estMin === "number" && p.estMin >= 0 ? p.estMin : null,
      estMax: typeof p.estMax === "number" && p.estMax >= 0 ? p.estMax : null,
      category: normalizeCategory(p.category) ?? "other",
      essential: p.essential !== false,
      searchQuery: (p.searchQuery || p.name || "").slice(0, 120),
      have: !!p.have,
    })),
  };
}

// ---------- Ask Nexus ----------

/** Compact snapshot of the user's data for the model. Items are referenced as [[id]]. */
function snapshot(data: AppData, currency: string, rates: Rates) {
  const cName = new Map(data.collections.map((c) => [c.id, c.name]));
  const lines = data.items.slice(0, 450).map((i) => {
    const unit = unitPrice(i, rates, currency);
    const line = lineTotal(i, rates, currency);
    const stores = [...new Set(i.sources.filter((s) => s.url).map((s) => s.store))].join("/");
    const parts = [
      `[[${i.id}]] ${i.title.slice(0, 90)}`,
      `status=${i.status}`,
      i.priority !== "normal" ? `priority=${i.priority}` : "",
      `qty=${i.quantity}`,
      unit != null ? `unit=${Math.round(unit * 100) / 100}` : "unit=?",
      line != null && i.quantity > 1 ? `total=${Math.round(line)}` : "",
      i.collectionId ? `project="${cName.get(i.collectionId) ?? "?"}"` : "project=none",
      stores ? `store=${stores}` : "",
      i.tags?.length ? `tags=${i.tags.join(",")}` : "",
      i.purchasedAt ? `bought=${new Date(i.purchasedAt).toISOString().slice(0, 10)}` : "",
      i.orderedAt && i.status === "ordered" ? `ordered=${new Date(i.orderedAt).toISOString().slice(0, 10)}` : "",
      i.targetPrice != null ? `target=${Math.round(convert(i.targetPrice, i.targetCurrency ?? currency, currency, rates))}` : "",
    ].filter(Boolean);
    return parts.join(" | ");
  });
  const projects = data.collections.map((c) => {
    const b = budgetStats(c, data.items, data.altGroups, rates, currency);
    return `- [${c.id}] ${c.kind} "${c.name}"${c.description ? ` (${c.description.slice(0, 80)})` : ""}: ${b.count} items, planned ${Math.round(b.planned)}, spent ${Math.round(b.spent)}${b.budget != null ? `, budget ${Math.round(b.budget)}` : ""}`;
  });
  return { lines, projects };
}

type AskInput = { question: string; history: { role: "user" | "assistant"; text: string }[]; data: AppData; currency: string; locale: "en" | "he" };

export async function askNexus(input: AskInput) {
  const r = askPrompt(input);
  return "mock" in r ? r.mock : generateText(r.prompt, { smart: true, system: r.system });
}

/** The prompt for a question (or the canned mock answer). Shared by the one-shot and the streaming path. */
export function askPrompt(input: AskInput): { mock: string } | { prompt: string; system: string } {
  if (mockAi()) {
    const first = input.data.items.find((i) => i.status === "to_buy");
    // Change requests get a proposal: the first two to-buy items → ordered (exercises propose → apply → undo).
    if (/\b(mark|move|set)\b|סמן|העבר/i.test(input.question)) {
      const ids = input.data.items.filter((i) => i.status === "to_buy").slice(0, 2).map((i) => i.id);
      const json = JSON.stringify({ summary: `Mark ${ids.length} items as ordered`, actions: [{ type: "setStatus", itemIds: ids, status: "ordered" }] });
      return { mock: `Marking ${ids.length} items as ordered.\n\n\`\`\`${ACTION_FENCE}\n${json}\n\`\`\`` };
    }
    return { mock: `You have **${input.data.items.filter((i) => i.status === "to_buy").length} items** left to buy.\n\n- Most urgent: ${first?.title ?? "—"} [[${first?.id ?? "x"}]]\n- Total planned: **${formatMoney(1234.5, input.currency, input.locale)}**` };
  }
  const { lines, projects } = snapshot(input.data, input.currency, input.data.rates);
  const system = `You are Nexus, the assistant inside the user's personal purchase manager. Answer questions about THEIR data below: what to buy, totals, budgets, what's missing for a project, what was bought when, which store is cheapest, etc.
Rules:
- Use ONLY the data given; if something isn't in the data, say so briefly.
- All money is in ${input.currency}; format like ${formatMoney(1234.5, input.currency, input.locale)}. Do the arithmetic carefully.
- When you mention a specific item, cite it as [[itemId]] right after its name so the app can link it.
- Start with ONE short lead sentence that answers the question directly (it is shown in bold), then details if needed.
- Be concise: short paragraphs or bullet lists (markdown "- "), **bold** for key numbers. No headings, no tables.
- Reply in ${input.locale === "he" ? "Hebrew" : "English"} unless the user writes in the other language.
- Only when the user asks you to CHANGE their data (mark as ordered/bought, move, set priority or quantity, tag, create a project), propose the change: one short sentence, then exactly one fenced block \`\`\`${ACTION_FENCE} with JSON {"summary": string, "actions": [...]}. Nothing changes until the user clicks Apply, so never say it's done. Never propose deletes.
  Allowed actions (nothing else):
  {"type":"move","itemIds":[…],"collectionId":"<project id>" or null for Unsorted}
  {"type":"setStatus","itemIds":[…],"status":"to_buy"|"ordered"|"purchased"}
  {"type":"setPriority","itemIds":[…],"priority":"urgent"|"normal"|"someday"}
  {"type":"setQty","itemIds":[…],"qty":2}
  {"type":"addTag"|"removeTag","itemIds":[…],"tag":"…"}
  {"type":"createCollection","ref":"n1","name":"…","kind":"project"|"list","budget":null} — then move to it with "collectionId":"new:n1"
  Use only ids from the data below ([[itemId]] for items, [id] for projects), at most ${MAX_ACTION_ITEMS} items. "summary" is one line in the reply language.
  Example 1 — "set the fan to urgent, qty 2":
  Setting the fan to urgent with quantity 2.
  \`\`\`${ACTION_FENCE}
  {"summary":"Fan → urgent, qty 2","actions":[{"type":"setPriority","itemIds":["aB3dE5fG7h"],"priority":"urgent"},{"type":"setQty","itemIds":["aB3dE5fG7h"],"qty":2}]}
  \`\`\`
  Example 2 — "move everything from AliExpress to a new project Drone":
  3 AliExpress items go to a new project, Drone.
  \`\`\`${ACTION_FENCE}
  {"summary":"Create Drone and move 3 AliExpress items there","actions":[{"type":"createCollection","ref":"n1","name":"Drone","kind":"project","budget":null},{"type":"move","itemIds":["k1","k2","k3"],"collectionId":"new:n1"}]}
  \`\`\`
Today is ${new Date().toISOString().slice(0, 10)}.

PROJECTS & LISTS ([id] kind "name")
${projects.join("\n") || "(none)"}

ITEMS (status: to_buy / ordered / purchased)
${lines.join("\n") || "(none)"}`;

  const convo = input.history
    .slice(-8)
    .map((m) => `${m.role === "user" ? "User" : "Nexus"}: ${m.text.slice(0, 1500)}`)
    .join("\n\n");
  const prompt = `${convo ? `${convo}\n\n` : ""}User: ${input.question.slice(0, 1500)}\n\nNexus:`;
  return { prompt, system };
}

// Local UI testing without network access to Gemini. Never active in production builds.
export function mockAi() {
  return process.env.NEXUS_AI_MOCK === "1" && !process.env.VERCEL;
}
const MOCK_PLAN = (currency: string): Plan => ({
  projectName: "Camera slider",
  summary: "Motorized 1.5 m slider on V-slot with ESP32 control.",
  currency,
  tips: ["Print the carriage plates in PETG.", "Buy the V-slot cut to length."],
  parts: [
    { name: "NEMA 17 stepper motor 42-40, 1.5A", qty: 1, spec: "Enough torque for a 2 kg camera", estMin: 30, estMax: 45, category: "mechanical", essential: true, searchQuery: "nema 17 stepper 42-40", have: false },
    { name: "TMC2209 stepper driver", qty: 1, spec: "Silent operation for video", estMin: 12, estMax: 20, category: "electronics", essential: true, searchQuery: "tmc2209 driver", have: false },
    { name: "Wireless follow-focus motor", qty: 1, spec: "Upgrade for focus pulls", estMin: 150, estMax: 300, category: "camera-audio", essential: false, searchQuery: "wireless follow focus motor", have: false },
  ],
});
