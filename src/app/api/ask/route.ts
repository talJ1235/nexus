import { z } from "zod";
import { aiEnabled, generateTextStream } from "@/lib/ai";
import { askPrompt, mockAi } from "@/lib/assistant";
import { newCollections, parseAnswer, planChanges } from "@/lib/assistant-actions";
import { assertOwner } from "@/lib/auth";
import { getAppData } from "@/lib/data";
import { CURRENCIES } from "@/lib/money";
import { clientDiagSchema } from "@/lib/diag-schema";
import { classifyQuestion } from "@/lib/help/route";
import { parseReportBlock } from "@/lib/reports";
import { pastSnippets } from "@/lib/conversations";
import { diagLines, helpText, serverDiag } from "@/lib/help/server";

export const maxDuration = 60;

const body = z.object({
  question: z.string().min(1).max(1500),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).max(20),
  currency: z.enum(CURRENCIES),
  locale: z.enum(["en", "he"]),
  // Round 8 D2: what the client can tell about itself, for "how do I / why doesn't" questions.
  diag: clientDiagSchema.optional(),
  // Round 9 C2: the conversation this question belongs to (excluded from the "last time" search).
  conversationId: z.string().max(40).nullable().optional(),
});

/**
 * Ask Nexus, streamed (Round 7 F1). Newline-delimited JSON events:
 *   {"t":"route","provider","fallback"}  which model answers (fallback = not the first choice)
 *   {"t":"delta","text"}                  answer text as it arrives
 *   {"t":"done","text","proposal","route"} the full answer, its action proposal parsed after the stream (R6.1); route =
 *                                         data / help / unsure (R8 D2); report = a drafted problem report (D3)
 *   {"t":"error","error":"no_ai"|"failed"}
 */
export async function POST(req: Request) {
  try {
    await assertOwner();
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let input: z.infer<typeof body>;
  try {
    input = body.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: unknown) => ctrl.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
      try {
        if (!aiEnabled() && !mockAi()) {
          send({ t: "error", error: "no_ai" });
          return;
        }
        const data = await getAppData();
        // Data question, how-to-use-the-app question, or both in front of the model (lib/help/route.ts).
        const { route, complaint } = classifyQuestion(input.question, data.collections.map((c) => c.name));
        const help = route === "data" ? undefined : helpText();
        const diag = route === "data" ? undefined : diagLines(input.diag, await serverDiag());
        // "How did I fix X last time?" → snippets from earlier conversations.
        const past = await pastSnippets(input.question, input.conversationId ?? null).catch(() => null);
        const p = askPrompt({ ...input, data, route, help, diag, complaint, past });
        let full = "";
        if ("mock" in p) {
          send({ t: "route", provider: "mock", fallback: false });
          // Canned answer in word-sized pieces, so the UI's streaming path is exercised locally.
          for (const piece of p.mock.match(/\S+\s*/g) ?? []) {
            full += piece;
            send({ t: "delta", text: piece });
            await new Promise((r) => setTimeout(r, 25));
          }
        } else {
          for await (const ev of generateTextStream(p.prompt, { smart: true, system: p.system })) {
            if (req.signal.aborted) return;
            if (ev.type === "route") send({ t: "route", provider: ev.provider, fallback: ev.fallback });
            else {
              full += ev.text;
              send({ t: "delta", text: ev.text });
            }
          }
        }
        if (!full.trim()) {
          send({ t: "error", error: "failed" });
          return;
        }
        const ids = { itemIds: new Set(data.items.map((i) => i.id)), collectionIds: new Set(data.collections.map((c) => c.id)) };
        const parsed = parseAnswer(full, ids);
        const proposal = parsed.proposal;
        // A drafted problem report (```nexus-report) → the report card (R8 D3).
        const { text, report } = parseReportBlock(parsed.text);
        const useful = proposal && (newCollections(proposal).length > 0 || planChanges(proposal, data.items).length > 0);
        send({ t: "done", text: text || proposal?.summary || "", proposal: useful ? proposal : null, report, route });
      } catch {
        send({ t: "error", error: "failed" });
      } finally {
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
