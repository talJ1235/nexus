"use server";

import { requireCtx } from "@/lib/ctx";

// R15 D1: per-list guest invites are retired (sharing is per space; public read-only links stay under each list's
// Share). getSharing reports nothing; the write actions answer an error.

export type SharingState = {
  invites: { id: string; role: "viewer" | "editor"; createdAt: number }[];
  members: { id: string; name: string; role: "viewer" | "editor"; lastSeenAt: number | null; createdAt: number }[];
};

const EMPTY: SharingState = { invites: [], members: [] };

async function gone(): Promise<never> {
  await requireCtx("edit");
  throw new Error("gone");
}

export async function getSharing(collectionId: string): Promise<SharingState> {
  void collectionId;
  await requireCtx("view");
  return EMPTY;
}

export async function createInvite(collectionId: string, r: "viewer" | "editor", origin: string): Promise<{ url: string; state: SharingState }> {
  void [collectionId, r, origin];
  return gone();
}

export async function revokeInvite(inviteId: string, collectionId: string): Promise<SharingState> {
  void [inviteId, collectionId];
  return gone();
}

export async function setMemberRole(memberId: string, collectionId: string, r: "viewer" | "editor"): Promise<SharingState> {
  void [memberId, collectionId, r];
  return gone();
}

export async function removeMember(memberId: string, collectionId: string): Promise<SharingState> {
  void [memberId, collectionId];
  return gone();
}
