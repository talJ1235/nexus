// Home (Round 13): the owner's dismissed rows / snoozed suggestions and the "AI-written suggestions" switch (kv).
import "server-only";
import type { HomePrefs } from "./home";
import { kvGetMany } from "./kv";

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

export async function loadHomePrefs(): Promise<HomePrefs> {
  const kv = await kvGetMany([HOME_DISMISSED_KEY, HOME_AI_KEY]);
  return { dismissed: parseDismissed(kv[HOME_DISMISSED_KEY]), aiSuggestions: kv[HOME_AI_KEY] !== "off" };
}
