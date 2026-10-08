import { type NextRequest } from "next/server";
import { aiHealth, aiProviders, generateText, lastAiErrors } from "@/lib/ai";
import { aiSystem } from "@/lib/ai-gate";
import { planProject } from "@/lib/assistant";
import { isAdmin, routeCtx } from "@/lib/ctx";

export const maxDuration = 60;

// Admin-only: end-to-end check of the Gemini setup. ?plan=1 also runs a small project plan.
export async function GET(req: NextRequest) {
  const ctx = await routeCtx("view");
  if (ctx instanceof Response) return ctx;
  if (!isAdmin(ctx)) return Response.json({ error: "not_found" }, { status: 404 });
  const providers = aiProviders();
  const hasKey = providers.length > 0;
  const started = Date.now();
  if (req.nextUrl.searchParams.get("plan")) {
    const plan = await planProject({ description: "Small desk weather station: ESP32, BME280 sensor, e-paper display, LiPo battery.", budget: null, currency: "ILS", locale: "en", existing: [], use: aiSystem("debug") });
    return Response.json({ ms: Date.now() - started, parts: plan?.parts.length ?? null, first: plan?.parts[0] ?? null, errors: lastAiErrors });
  }
  const fast = hasKey ? await generateText("Reply with exactly: ok", { use: aiSystem("debug") }) : null;
  const smart = hasKey ? await generateText("Reply with exactly: ok", { use: aiSystem("debug"), smart: true }) : null;
  return Response.json({ providers, hasKey, fast, smart, ms: Date.now() - started, errors: lastAiErrors, health: aiHealth() });
}
