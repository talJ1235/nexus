import "server-only";

// R17 S3 M — the time-based senders the hourly dispatcher runs before sending (filled in by Part M).
export async function runNotifySweeps(now = Date.now()) {
  void now;
  return {};
}
