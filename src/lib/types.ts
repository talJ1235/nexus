import type { Alert, AltGroup, Attachment, Collection, Grant, Invite, Item, Member, PricePoint, Source, StoreSetting } from "@/db/schema";
import type { Rates } from "./money";

export type { Alert, AltGroup, Attachment, Collection, Grant, Invite, Item, Member, PricePoint, Source, StoreSetting };
export type ItemWithSources = Item & { sources: Source[]; points: PricePoint[]; attachments: Attachment[] };

export type AppData = {
  collections: Collection[];
  items: ItemWithSources[];
  altGroups: AltGroup[];
  storeSettings: StoreSetting[];
  rates: Rates;
  aiEnabled: boolean;
};

export type SourceDraft = {
  url: string;
  normalizedUrl: string;
  store: string;
  storeKey: string;
  price: number | null;
  currency: string;
  shipping: number | null;
  availability: string | null;
  rawTitle: string | null;
  extractMethod: string;
};

export type ItemDraft = {
  title: string;
  brand: string | null;
  imageUrl: string | null;
  category: string | null;
  tags: string[];
  collectionId: string | null;
  source: SourceDraft;
  quality: "full" | "partial" | "failed";
};

export type Duplicate = { itemId: string; title: string; reason: "url" | "title" };

export type PreviewResult = { draft: ItemDraft; duplicate: Duplicate | null };
