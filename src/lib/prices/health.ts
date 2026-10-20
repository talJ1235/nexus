// R19 B5 — when a chain's prices are old (pure, client-safe; test:prices). A chain whose newest file read is older than
// 26 h (the nightly files missed a night) shows "prices may be old" in the app and is flagged in Admin → System.
export const STALE_MS = 26 * 3_600_000;
export const isStale = (lastFileAt: number | null | undefined, now = Date.now()) => lastFileAt == null || now - lastFileAt > STALE_MS;
