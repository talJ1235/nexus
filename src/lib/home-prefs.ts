// Home (Round 13): the user's dismissed rows / snoozed suggestions and the "AI-written suggestions" switch (user_pref, R15).
import "server-only";
import { userPrefGetMany } from "./db-scoped/prefs";
import type { HomePrefs } from "./home";

export const HOME_DISMISSED_KEY = "pref:home:dismissed";
export const HOME_AI_KEY = "pref:home:ai";

export function parseDismissed(raw: string | null | undefined, now = Date.now()): Record<string, number> {
  try {
    const v = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    // Expired entries drop out, so the map stays small.
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > now));
  } catch {
    return {};
  }
}

export async function loadHomePrefs(userId: string): Promise<HomePrefs> {
  const kv = await userPrefGetMany(userId, [HOME_DISMISSED_KEY, HOME_AI_KEY]);
  return { dismissed: parseDismissed(kv[HOME_DISMISSED_KEY]), aiSuggestions: kv[HOME_AI_KEY] !== "off" };
}
