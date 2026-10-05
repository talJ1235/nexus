// R15 D2: Telegram is off for everyone — the webhook answers 410 Gone (authz allow-list: retired, no data).
// The bot code stays in src/lib/telegram.ts in case it is revived per user.
export async function POST() {
  return new Response("Gone", { status: 410 });
}
