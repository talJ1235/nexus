// Home (Round 13): the user's dismissed rows / snoozed suggestions and the "AI-written suggestions" switch (user_pref, R15).
import "server-only";
import { ONBOARDING_KEY, parseOnboarding } from "./onboarding";
import { userPrefGetMany } from "./db-scoped/prefs";
import { parseLayout } from "./home-layout";
import { DEFAULT_NOTIFY, type HomePrefs, type NotifyPrefs } from "./home";

export const HOME_DISMISSED_KEY = "pref:home:dismissed";
export const HOME_AI_KEY = "pref:home:ai";
/** R16 D1: Settings → Notifications (JSON, missing keys = on). The drop threshold stays in the tracker's `pref:alerts`. */
export const NOTIFY_KEY = "pref:notify";
const ALERTS_KEY = "pref:alerts";

export function parseNotify(raw: string | null | undefined, alertsRaw: string | null | undefined): NotifyPrefs {
  let v: Partial<NotifyPrefs> = {};
  let pct = DEFAULT_NOTIFY.minDropPct;
  try {
    v = JSON.parse(raw ?? "{}");
  } catch {}
  try {
    const a = JSON.parse(alertsRaw ?? "{}") as { minDropPct?: unknown };
    if (typeof a.minDropPct === "number") pct = a.minDropPct;
  } catch {}
  // R17 D3: the per-kind switches are gone — their behaviour is the default again (on); only the master switch is read.
  return { ...DEFAULT_NOTIFY, minDropPct: pct, on: (v as { on?: unknown }).on !== false };
}

export function parseDismissed(raw: string | null | undefined, now = Date.now()): Record<string, number> {
  try {
    const v = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    // Expired entries drop out, so the map stays small.
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > now));
  } catch {
    return {};
  }
}

/** R16 E1: Home's layout per space; the last one saved anywhere is the fallback. */
export const HOME_LAYOUT_KEY = "pref:home:layout";
export const homeLayoutKey = (spaceId: string) => `${HOME_LAYOUT_KEY}:${spaceId}`;

export async function loadHomePrefs(userId: string, spaceId?: string): Promise<HomePrefs> {
  const kv = await userPrefGetMany(userId, [HOME_DISMISSED_KEY, HOME_AI_KEY, NOTIFY_KEY, ALERTS_KEY, HOME_LAYOUT_KEY, ONBOARDING_KEY, ...(spaceId ? [homeLayoutKey(spaceId)] : [])]);
  const layout = (spaceId ? parseLayout(kv[homeLayoutKey(spaceId)]) : null) ?? parseLayout(kv[HOME_LAYOUT_KEY]);
  return { dismissed: parseDismissed(kv[HOME_DISMISSED_KEY]), aiSuggestions: kv[HOME_AI_KEY] !== "off", notify: parseNotify(kv[NOTIFY_KEY], kv[ALERTS_KEY]), layout, stores: parseOnboarding(kv[ONBOARDING_KEY])?.stores.filter((s) => !s.startsWith("custom:")) ?? [] };
}
