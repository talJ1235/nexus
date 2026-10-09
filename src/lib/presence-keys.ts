// R17 G1 — the admin Live view's vocabulary, shared by the client beat and the server (pure, no I/O).
// `screen` is always one of these keys (never a title, a name or a URL); activity is a kind + a count, never content.

export const SCREENS = [
  "home",
  "to-buy",
  "on-the-way",
  "history",
  "shopping-mode",
  "projects",
  "insights",
  "item",
  "settings",
  "assistant",
  "onboarding-1",
  "onboarding-2",
  "onboarding-3",
  "onboarding-4",
  "onboarding-5",
  "onboarding-6",
  "onboarding-7",
  "admin",
  "other",
] as const;
export type ScreenKey = (typeof SCREENS)[number];
export const isScreen = (v: unknown): v is ScreenKey => typeof v === "string" && (SCREENS as readonly string[]).includes(v);

export const ACTIVITY_KINDS = [
  "opened",
  "items_added",
  "checked_off",
  "link_added",
  "shopping_started",
  "shopping_finished",
  "delivery_received",
  "joined_code",
  "joined_space",
  "onboarding_step",
  "assistant_asked",
  "deletion_requested",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** Online = a beat at most this old. */
export const ONLINE_MS = 75_000;
/** The client beats this often while the page is visible. */
export const BEAT_MS = 30_000;
/** The admin Live view polls this often while visible. */
export const LIVE_POLL_MS = 5_000;
/** Kinds whose rows merge within this window (check-offs while shopping come in bursts). */
export const MERGE_MS = 10_000;
export const PRESENCE_KEEP_MS = 7 * 86_400_000;
export const ACTIVITY_KEEP_MS = 30 * 86_400_000;

export type Device = "phone" | "computer";

/** Phone = a coarse pointer and a viewport narrower than 1024 px; anything else is a computer. */
export function deviceOf(coarse: boolean, width: number): Device {
  return coarse && width < 1024 ? "phone" : "computer";
}

/** "Android · Chrome" from UA-CH or the UA — OS family + browser, nothing finer. */
export function platformOf(ua: string, chPlatform?: string | null): string {
  const os =
    chPlatform && /^(Android|Windows|macOS|iOS|Chrome OS|ChromeOS|Linux)$/.test(chPlatform)
      ? chPlatform.replace("Chrome OS", "ChromeOS").replace("iOS", "iPhone")
      : /iPhone|iPod/.test(ua)
        ? "iPhone"
        : /iPad/.test(ua)
          ? "iPad"
          : /Android/.test(ua)
            ? "Android"
            : /Windows/.test(ua)
              ? "Windows"
              : /Mac OS X|Macintosh/.test(ua)
                ? "macOS"
                : /CrOS/.test(ua)
                  ? "ChromeOS"
                  : /Linux/.test(ua)
                    ? "Linux"
                    : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /OPR\//.test(ua) ? "Opera" : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [os, browser].filter(Boolean).join(" · ").slice(0, 40);
}

/** What a beat carries (validated on the server; `screen` must be a known key). */
export type BeatInput = { device: Device; app: "installed" | "browser"; screen: ScreenKey; shoppingLeft: number | null };

export function parseBeat(raw: unknown): BeatInput | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (b.device !== "phone" && b.device !== "computer") return null;
  if (b.app !== "installed" && b.app !== "browser") return null;
  if (!isScreen(b.screen)) return null;
  const left = typeof b.shoppingLeft === "number" && Number.isInteger(b.shoppingLeft) && b.shoppingLeft >= 0 && b.shoppingLeft < 100_000 ? b.shoppingLeft : null;
  return { device: b.device, app: b.app, screen: b.screen, shoppingLeft: left };
}
