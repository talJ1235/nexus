import type { Alert, AltGroup, Attachment, Collection, Grant, Invite, Item, Member, PricePoint, Receipt, Source, StoreSetting } from "@/db/schema";
import type { BudgetHistory } from "./budget";
import type { HomePrefs } from "./home";
import type { Rates } from "./money";

export type { Alert, AltGroup, Attachment, Collection, Grant, Invite, Item, Member, PricePoint, Receipt, Source, StoreSetting };
export type ItemWithSources = Item & { sources: Source[]; points: PricePoint[]; attachments: Attachment[] };

export type AppData = {
  collections: Collection[];
  items: ItemWithSources[];
  altGroups: AltGroup[];
  storeSettings: StoreSetting[];
  /** Monthly spending cap per month it was set (see lib/budget). */
  budget: BudgetHistory;
  rates: Rates;
  aiEnabled: boolean;
  /** VAT-free personal import limit in USD (G2); missing in older offline snapshots → the default. */
  importLimitUsd?: number;
  /** Round 13 Home: recent alerts (Needs you) and the owner's Home prefs; missing in older offline snapshots. */
  alerts?: Alert[];
  home?: HomePrefs;
  /** R15: the current space and the caller's role in it (uploads go under spaces/<id>/; viewers get no write controls). */
  space?: SpaceInfo;
};

export type SpaceInfo = { id: string; name: string; kind: "personal" | "shared"; color: string; icon: string; currency: string; role: "owner" | "member" | "viewer" };

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
  gtin?: string | null;
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
