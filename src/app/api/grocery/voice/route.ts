import { routeCtx } from "@/lib/ctx";
import { generateJson } from "@/lib/ai";
import { aiGate, aiUse, recordAiUsage } from "@/lib/ai-gate";
import { mockAi } from "@/lib/assistant";
import { itemLines } from "@/lib/grocery/recorder";
import { splitList } from "@/lib/grocery/parse";

// R18 S4 C1 — voice add: POST the recording (audio/wav, or the recorder's own webm / mp4 / ogg; ≤ 60 s, ≤ 4 MB) →
// { state: "read", text, lines } (the products with their amounts, as lines for the Paste review) | { state: "empty" }
// (nothing heard) | { state: "limit" } (the daily AI quota) | { state: "failed" }. One AI call through ai-gate (feature
// `grocery`, counts in the person's quota). The audio is only passed to the model — never stored.
// Mock AI (tests): the body as text "mockvoice:<what was said>" → split like a pasted line.

const MAX_BYTES = 4_000_000;
const TYPES = /^audio\/(wav|x-wav|webm|mp4|aac|ogg|mpeg)$/;

const PROMPT = (locale: string) =>
  [
    "This is a person saying what to put on their supermarket shopping list, in Hebrew or English (or mixed).",
    '"text": what they said, word for word, in the language spoken.',
    '"items": every product they asked for, in the order said: "name" the product as a shopping list would write it, in',
    'the language spoken (Hebrew stays Hebrew, keep variants like "3%" or "מלא"); "qty" the number of units / packs',
    '(שני / two = 2; 1 when not said); "amount" + "unit" ("kg" | "g" | "l") only for a weight or volume',
    '("חצי קילו" = 0.5 kg, "200 גרם" = 200 g, "ליטר" = 1 l), else null.',
    "Fillers, corrections and words that aren't products are left out; a product said twice is one item.",
    `The app's language is ${locale === "he" ? "Hebrew" : "English"}.`,
  ].join(" ");

type Said = { text: string; items: { name: string; qty: number | null; amount: number | null; unit: string | null }[] };

export async function POST(req: Request) {
  const ctx = await routeCtx("edit");
  if (ctx instanceof Response) return ctx;
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!TYPES.test(type)) return Response.json({ error: "type" }, { status: 415 });
  const body = new Uint8Array(await req.arrayBuffer());
  if (!body.length || body.length > MAX_BYTES) return Response.json({ error: "size" }, { status: 413 });
  const locale = new URL(req.url).searchParams.get("locale") === "he" ? "he" : "en";
  const use = aiUse(ctx, "grocery");
  const gate = await aiGate(use);
  if (!gate.ok) return Response.json({ state: gate.reason === "quota" ? "limit" : "failed" });
  let said: Said | null;
  if (mockAi()) {
    const text = Buffer.from(body).toString("utf8");
    said = text.startsWith("mockvoice:") ? { text: text.slice(10).trim(), items: [] } : { text: "", items: [] };
    await recordAiUsage(use, { provider: "mock", model: "mock", ok: true, ms: 0 });
  } else
    said = await generateJson<Said>(
      PROMPT(locale),
      {
        type: "object",
        properties: {
          text: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, qty: { type: "number", nullable: true }, amount: { type: "number", nullable: true }, unit: { type: "string", nullable: true } },
              required: ["name", "qty", "amount", "unit"],
            },
          },
        },
        required: ["text", "items"],
      },
      { use, file: { mimeType: type === "audio/x-wav" ? "audio/wav" : type, data: Buffer.from(body).toString("base64") }, budgetMs: 25_000 },
    );
  if (!said) return Response.json({ state: "failed" });
  const text = String(said.text ?? "").trim().slice(0, 2000);
  // The model's items; the mock (and a model that only transcribed) → the words split like a pasted line.
  const lines = said.items?.length ? itemLines(said.items) : text ? splitList(text).map((p) => p.text) : [];
  if (!lines.length) return Response.json({ state: "empty", text });
  return Response.json({ state: "read", text, lines }, { headers: { "cache-control": "private, no-store" } });
}
