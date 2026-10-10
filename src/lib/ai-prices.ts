// R17 S5 S5 — list prices of the models Nexus calls, for Admin → AI usage "If it were paid". USD per million tokens
// (input, output), paid tier, standard. The next check is one edit: open each source, update the rows and CHECKED.
// First match wins (more specific patterns first). Free-tier usage costs Nexus nothing today; this is "if it were paid".

export const AI_PRICES_CHECKED = "2026-10-10";

export const AI_PRICE_SOURCES = [
  { name: "Google AI (Gemini)", url: "https://ai.google.dev/gemini-api/docs/pricing" },
  { name: "Groq", url: "https://console.groq.com/docs/models" },
  { name: "OpenRouter", url: "https://openrouter.ai/openrouter/free" },
] as const;

export type AiPrice = { match: RegExp; input: number; output: number; note?: string };

export const AI_PRICES: AiPrice[] = [
  // Google's page (last updated 2026-10-09). 3.6 / 3.8 Flash go to $1.50 / $7.50 on 2027-01-01.
  { match: /gemini-3\.8-flash(?!-lite)/i, input: 0.75, output: 3.75 },
  { match: /gemini-3\.6-flash(?!-lite)/i, input: 0.75, output: 3.75 },
  { match: /gemini-3\.5-flash-lite/i, input: 0.3, output: 2.5 },
  { match: /gemini-3\.1-flash-lite/i, input: 0.25, output: 1.5 },
  { match: /gemini-2\.5-flash-lite/i, input: 0.1, output: 0.4 },
  { match: /gemini-2\.5-flash/i, input: 0.3, output: 2.5 },
  // Not on the page any more (2026-10-10): counted at the price of its successor, 3.6 Flash.
  { match: /gemini-3\.5-flash(?!-lite)/i, input: 0.75, output: 3.75, note: "not listed; 3.6 Flash price" },
  { match: /gemini.*flash-lite/i, input: 0.3, output: 2.5 },
  { match: /gemini.*flash/i, input: 0.75, output: 3.75 },
  // Groq.
  { match: /gpt-oss-120b/i, input: 0.15, output: 0.6 },
  { match: /gpt-oss-20b/i, input: 0.075, output: 0.3 },
  // OpenRouter's router to free models.
  { match: /^openrouter\/free$|:free$/i, input: 0, output: 0 },
];

/** The price row for a model (unknown: the provider's typical model — Gemini Flash, Groq 120B, OpenRouter free). */
export function priceOf(model: string | null, provider: string | null): AiPrice {
  const p = AI_PRICES.find((x) => x.match.test(model ?? ""));
  if (p) return p;
  if (provider === "openrouter") return { match: /./, input: 0, output: 0 };
  if (provider === "groq") return { match: /./, input: 0.15, output: 0.6 };
  return { match: /./, input: 0.75, output: 3.75 };
}
