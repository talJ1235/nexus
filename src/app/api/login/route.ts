// R17 E1: the admin password sign-in is gone (Google for everyone; admin emergency access is POST /api/emergency).
const gone = () => new Response("Gone", { status: 410, headers: { "cache-control": "no-store" } });
export const GET = gone;
export const POST = gone;
