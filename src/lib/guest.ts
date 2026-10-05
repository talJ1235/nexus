// R15 D1: the old guest system (members / grants / invites, /g, /i/<token>) is retired — editing needs an account and
// sharing is per space. The tables stay read-only until R16; only the guest app's data type remains for its component.
import type { Rates } from "./money";
import type { Collection, ItemWithSources } from "./types";

export type GuestData = {
  member: { id: string; name: string };
  collections: (Collection & { role: "viewer" | "editor" })[];
  items: ItemWithSources[];
  rates: Rates;
  aiEnabled: boolean;
};
