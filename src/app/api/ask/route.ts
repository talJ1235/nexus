import { z } from "zod";
import { aiEnabled, generateTextStream } from "@/lib/ai";
import { askPrompt, mockAi } from "@/lib/assistant";
import { newCollections, parseAnswer, planChanges } from "@/lib/assistant-actions";
import { assertOwner } from "@/lib/auth";
import { getAppData } from "@/lib/data";
import { CURRENCIES } from "@/lib/money";

export const maxDuration = 60;

const body = z.object({
  question: z.string().min(1).max(1500),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).max(20),
  currency: z.enum(CURRENCIES),
  locale: z.enum(["en", "he"]),
});

/**
 * Ask Nexus, streamed (Round 7 F1). Newline-delimited JSON events:
 *   {"t":"route","provider","fallback"}  which model answers (fallback = not the first choice)
 *   {"t":"delta","text"}                  answer text as it arrives
 *   {"t":"done","text","proposal"}        the full answer, its action proposal parsed after the stream (R6.1)
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
        const p = askPrompt({ ...input, data });
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
        const { text, proposal } = parseAnswer(full, ids);
        const useful = proposal && (newCollections(proposal).length > 0 || planChanges(proposal, data.items).length > 0);
        send({ t: "done", text: text || proposal?.summary || "", proposal: useful ? proposal : null });
      } catch {
        send({ t: "error", error: "failed" });
      } finally {
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
