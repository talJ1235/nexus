import "server-only";
import { cookies } from "next/headers";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { getRates } from "./rates";
import { GUEST_COOKIE, verifyGuestValue } from "./guest-session";
import type { Collection, Grant, ItemWithSources, Member } from "./types";
import type { Rates } from "./money";

export type Guest = { member: Member; grants: Grant[] };

/** The current guest, or null. Checks signature, expiry AND revocation (DB), every call. */
export async function getGuest(): Promise<Guest | null> {
  const memberId = await verifyGuestValue((await cookies()).get(GUEST_COOKIE)?.value);
  if (!memberId) return null;
  const member = await db.query.members.findFirst({ where: and(eq(schema.members.id, memberId), isNull(schema.members.revokedAt)) });
  if (!member) return null;
  const grants = await db.select().from(schema.grants).where(eq(schema.grants.memberId, memberId));
  if (!grants.length) return null;
  // Touch "last seen" at most every 10 minutes.
  if (!member.lastSeenAt || Date.now() - member.lastSeenAt > 600_000) {
    await db.update(schema.members).set({ lastSeenAt: Date.now() }).where(eq(schema.members.id, memberId));
  }
  return { member, grants };
}

export async function requireGuest(): Promise<Guest> {
  const g = await getGuest();
  if (!g) throw new Error("unauthorized");
  return g;
}

export function roleFor(g: Guest, collectionId: string | null | undefined): "viewer" | "editor" | null {
  if (!collectionId) return null;
  const grant = g.grants.find((x) => x.collectionId === collectionId);
  return grant?.role ?? null;
}

/** Load an item only if the guest may see it; `edit` additionally requires the editor role. */
export async function guestItem(g: Guest, itemId: string, need: "view" | "edit") {
  const item = await db.query.items.findFirst({ where: eq(schema.items.id, itemId) });
  const role = roleFor(g, item?.collectionId);
  if (!item || !role || (need === "edit" && role !== "editor")) throw new Error("forbidden");
  return item;
}

export type GuestData = {
  member: { id: string; name: string };
  collections: (Collection & { role: "viewer" | "editor" })[];
  items: ItemWithSources[];
  rates: Rates;
  aiEnabled: boolean;
};

/** Only what was shared: the granted collections and their items. Receipts are never exposed to guests. */
export async function getGuestData(g: Guest): Promise<GuestData> {
  const ids = g.grants.map((x) => x.collectionId);
  const [collections, items, rates] = await Promise.all([
    db.select().from(schema.collections).where(inArray(schema.collections.id, ids)).orderBy(asc(schema.collections.sortOrder)),
    db.select().from(schema.items).where(inArray(schema.items.collectionId, ids)).orderBy(desc(schema.items.createdAt)),
    getRates(),
  ]);
  const itemIds = items.map((i) => i.id);
  const [sources, points] = itemIds.length
    ? await Promise.all([
        db.select().from(schema.sources).where(inArray(schema.sources.itemId, itemIds)).orderBy(asc(schema.sources.createdAt)),
        db.select().from(schema.pricePoints).where(inArray(schema.pricePoints.itemId, itemIds)).orderBy(asc(schema.pricePoints.recordedAt)),
      ])
    : [[], []];
  const by = <T extends { itemId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.itemId, [...(m.get(r.itemId) ?? []), r]);
    return m;
  };
  const s = by(sources);
  const p = by(points);
  return {
    member: { id: g.member.id, name: g.member.name },
    collections: collections.map((c) => ({ ...c, shareToken: null, role: roleFor(g, c.id)! })),
    items: items.map((i) => ({ ...i, sources: s.get(i.id) ?? [], points: p.get(i.id) ?? [], attachments: [] })),
    rates,
    aiEnabled: false,
  };
}
