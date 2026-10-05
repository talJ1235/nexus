// R15 D2: the browser extension is off for everyone — its endpoints answer 410 Gone (authz allow-list: retired, no
// data). The extension's code stays in the repo (extension/), in case it is revived with per-user tokens.
const gone = () => new Response("Gone", { status: 410 });
export const GET = gone;
export const POST = gone;
