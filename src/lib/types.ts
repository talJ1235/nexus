import type { Collection, Item, Source } from "@/db/schema";
import type { Rates } from "./money";

export type { Collection, Item, Source };
export type ItemWithSources = Item & { sources: Source[] };

export type AppData = {
  collections: Collection[];
  items: ItemWithSources[];
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
