// R15 D1: old guest invites are retired (authz allow-list: retired endpoint, no data).
export async function POST() {
  return new Response("Gone", { status: 410 });
}
