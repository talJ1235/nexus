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
  /** R16 D2: warn the space at 80 % of the monthly budget (missing = on). */
  budgetWarn?: boolean;
  /** Round 13 Home: recent alerts (Needs you) and the owner's Home prefs; missing in older offline snapshots. */
  alerts?: Alert[];
  home?: HomePrefs;
  /** R15: the current space and the caller's role in it (uploads go under spaces/<id>/; viewers get no write controls). */
  space?: SpaceInfo;
  /** R15: who is signed in (admin = ADMIN_EMAIL's user: Settings → Invite codes). */
  me?: { id?: string; name: string; email: string; admin: boolean; /** R17 P3 */ image?: string | null; since?: number };
  /** R15 C1: every space the user is in (switcher), personal first. */
  spaces?: SpaceCard[];
  /** R15 C4: people of the current shared space ("added by" avatars); empty in a personal space. */
  people?: Person[];
  /** R16 B1: the space's change-feed revision this data is at (read before the data, so nothing is skipped). */
  rev?: number;
};

export type Person = { id: string; name: string; /** R17 P3: their photo (checked by personPhoto before it shows) */ image?: string | null };
export type SpaceCard = { id: string; name: string; kind: "personal" | "shared"; color: string; icon?: string; photo?: string | null; role: "owner" | "member" | "viewer"; count: number; faces: Person[] };

export type SpaceInfo = { id: string; name: string; kind: "personal" | "shared"; color: string; icon: string; photo?: string | null; createdAt?: number; currency: string; role: "owner" | "member" | "viewer" };

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
  /** R17 B1: the store's original title when `title` is a short name. */
  fullTitle?: string | null;
  /** R17 B1: a pack count read from the title ("Two Pieces …"). */
  quantity?: number;
  brand: string | null;
  imageUrl: string | null;
  category: string | null;
  tags: string[];
  collectionId: string | null;
  source: SourceDraft;
  quality: "full" | "partial" | "failed";
  /** R17 C2: the store refused every rung of the fetch ladder and no price was found — "add the price by hand". */
  blocked?: boolean;
};

export type Duplicate = { itemId: string; title: string; reason: "url" | "title" };

export type PreviewResult = { draft: ItemDraft; duplicate: Duplicate | null };
