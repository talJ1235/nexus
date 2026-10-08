# Nexus fetch worker (R17 C2) — for stores that block Vercel

Some stores (cwc.co.il and others behind Cloudflare/Akamai) refuse Vercel's server addresses, so Nexus can't read
their product pages. This tiny Cloudflare Worker fetches the page from Cloudflare's network instead. Without it
everything still works — those stores just fall back to the other methods ("add the price by hand").

Free tier: 100,000 requests/day.

## Set it up (≈ 10 minutes, once)

1. dash.cloudflare.com → sign up (free, no credit card).
2. **Workers & Pages → Create → "Hello World" worker** → name it `nexus-fetch` → **Deploy**.
3. Make a secret: any long random string, 40+ characters (e.g. from your password manager).
   Worker → **Settings → Variables and Secrets → Add**: name `FETCH_SECRET`, type **Secret**, value = that string.
4. Worker → **Edit code** → replace everything with the contents of `fetch-worker.js` (this folder) → **Deploy**.
5. Vercel → Project → Settings → Environment Variables (Production):
   - `CF_FETCH_URL` = the worker's address, e.g. `https://nexus-fetch.<your-name>.workers.dev`
   - `CF_FETCH_SECRET` = the same secret string
   Add the same two lines to `.env.local` for local runs. Redeploy (or wait for the next deploy).

## Check it

- `curl -H "x-fetch-secret: <secret>" "https://nexus-fetch.<you>.workers.dev/?url=https%3A%2F%2Fexample.com"` → the page.
- Without the header → `401`. A private address (`?url=http%3A%2F%2F10.0.0.1`) → `403`.
- In Nexus: paste a cwc.co.il product link — it should come in with its name, price and picture.
- Admin: `/api/debug/blocked?host=cwc.co.il` shows which rung of the ladder read it.

## What it does and doesn't do

- Needs the secret header; only `http(s)`; refuses localhost / private / link-local IP literals; follows ≤ 5 redirects
  (each checked); ≤ 2.5 MB; 9 s per fetch; sends no cookies and passes none back.
- Nexus checks the link itself before asking (the same SSRF guard as every other fetch), and remembers per store
  which method worked (7 days) so it doesn't ask the worker when it doesn't need to.
- To turn it off: remove `CF_FETCH_URL` from Vercel (or delete the worker).
