"use server";

import { requireCtx } from "@/lib/ctx";
import type { GuestData } from "@/lib/guest";
import type { ItemWithSources } from "@/lib/types";

// R15 D1: guest server actions are retired — each answers an error. (Account holders share through spaces.)
async function gone(): Promise<never> {
  await requireCtx("view");
  throw new Error("gone");
}

export async function guestReload(): Promise<GuestData> {
  return gone();
}

export async function guestAddItem(url: string, collectionId: string): Promise<{ item: ItemWithSources; existed: boolean }> {
  void url;
  void collectionId;
  return gone();
}

export async function guestRepairItem(itemId: string): Promise<ItemWithSources> {
  void itemId;
  return gone();
}

export async function guestUpdateItem(itemId: string, p: Record<string, unknown>): Promise<ItemWithSources> {
  void itemId;
  void p;
  return gone();
}

export async function guestSetStatus(itemId: string, status: "to_buy" | "ordered" | "purchased"): Promise<ItemWithSources> {
  void itemId;
  void status;
  return gone();
}

export async function guestDeleteItem(itemId: string): Promise<void> {
  void itemId;
  return gone();
}
