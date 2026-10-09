// R17 S3 L1 — when the generic "Turn on notifications?" card may show (pure; unit-tested in test:notify).
// State per person: `pref:notify-ask` = { count, lastNo, shown }. `count` = how many times they said "Not now"
// (onboarding step 6 counts as the first). The card comes back 3, 7, 14 and 30 days after the last "Not now" — four
// cards after the onboarding offer — then never again (the inbox banner and Settings stay).

export const ASK_KEY = "pref:notify-ask";
export const ASK_STEPS_DAYS = [3, 7, 14, 30] as const;
const DAY = 86_400_000;
/** "Not the first session after onboarding": nothing within a day of finishing it. */
export const AFTER_ONBOARDING_MS = DAY;
/** Home must be settled this long (no sheet / dialog) before the card enters. */
export const SETTLE_MS = 1500;

export type AskState = { count: number; lastNo: number | null; shown: string | null; granted?: boolean };

export function parseAsk(raw: string | null | undefined): AskState {
  try {
    const v = JSON.parse(raw ?? "{}") as Partial<AskState>;
    return {
      count: typeof v.count === "number" && v.count >= 0 ? Math.min(99, Math.floor(v.count)) : 0,
      lastNo: typeof v.lastNo === "number" ? v.lastNo : null,
      shown: typeof v.shown === "string" ? v.shown.slice(0, 10) : null,
      granted: v.granted === true,
    };
  } catch {
    return { count: 0, lastNo: null, shown: null };
  }
}

/** The server's half: is a card due for this person today (device and screen checks happen on the client)? */
export function askDue(a: AskState, o: { now: number; today: string; switchOn: boolean; onboardingAt: number | null }) {
  if (!o.switchOn || a.granted) return false;
  if (a.shown === o.today) return false; // at most once a day
  if (o.onboardingAt != null && o.now - o.onboardingAt < AFTER_ONBOARDING_MS) return false;
  if (a.count === 0) return true; // never offered (signed up before onboarding, or skipped that step)
  if (a.count > ASK_STEPS_DAYS.length) return false;
  if (a.lastNo == null) return true;
  return o.now - a.lastNo >= ASK_STEPS_DAYS[a.count - 1] * DAY;
}

/** The client's half: this device and this moment. */
export function askHere(o: { perm: "granted" | "denied" | "default" | "unsupported" | "iphone-browser"; screen: string; settledMs: number; overlay: boolean; shopping: boolean }) {
  if (o.perm === "granted" || o.perm === "unsupported") return false;
  return o.screen === "home" && o.settledMs >= SETTLE_MS && !o.overlay && !o.shopping;
}

export const saidNo = (a: AskState, now: number, today: string): AskState => ({ ...a, count: a.count + 1, lastNo: now, shown: today });
export const wasShown = (a: AskState, today: string): AskState => ({ ...a, shown: today });
export const saidYes = (a: AskState): AskState => ({ ...a, granted: true });
