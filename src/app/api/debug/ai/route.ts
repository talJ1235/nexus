import { generateText, lastAiErrors } from "@/lib/ai";

export const maxDuration = 60;

// Owner-only (proxy): quick end-to-end check of the Gemini setup.
export async function GET() {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  const started = Date.now();
  const fast = hasKey ? await generateText("Reply with exactly: ok") : null;
  const smart = hasKey ? await generateText("Reply with exactly: ok", { smart: true }) : null;
  return Response.json({ hasKey, fast, smart, ms: Date.now() - started, errors: lastAiErrors });
}
