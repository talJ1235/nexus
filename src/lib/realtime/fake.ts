import "server-only";

// R16 B2 — a local fake of the realtime service for tests (test:live, smokes) so CI needs no Ably key. Same process
// only (one `next dev` server). Refused in production, like AUTH_TEST_IDP.

export const fakeTransport = (env: Record<string, string | undefined> = process.env) => env.REALTIME_FAKE === "1" && env.NODE_ENV !== "production";

type Msg = { rev: number; by: string };
type Listener = (m: { type: "change"; data: Msg } | { type: "presence"; data: Presence[] }) => void;
export type Presence = { clientId: string; mode: "app" | "shopping" };

class Bus {
  private subs = new Map<string, Set<Listener>>();
  private present = new Map<string, Map<string, Presence>>();
  subscribe(channel: string, l: Listener) {
    const set = this.subs.get(channel) ?? new Set();
    set.add(l);
    this.subs.set(channel, set);
    return () => set.delete(l);
  }
  publish(channel: string, data: Msg) {
    for (const l of this.subs.get(channel) ?? []) l({ type: "change", data });
  }
  enter(channel: string, p: Presence, conn: string) {
    const m = this.present.get(channel) ?? new Map();
    m.set(conn, p);
    this.present.set(channel, m);
    this.presence(channel);
  }
  leave(channel: string, conn: string) {
    this.present.get(channel)?.delete(conn);
    this.presence(channel);
  }
  private presence(channel: string) {
    const list = [...(this.present.get(channel)?.values() ?? [])];
    for (const l of this.subs.get(channel) ?? []) l({ type: "presence", data: list });
  }
}

const g = globalThis as unknown as { __nexusFakeBus?: Bus };
export const fakeBus = () => (g.__nexusFakeBus ??= new Bus());
