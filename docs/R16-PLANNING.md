# Round 16 — planning notes (planner, 2026-10-06, account B)

Companion to `docs/ROUND16.md` (the brief) and `docs/R16-NOTES.md` (Tal's raw notes). For the planner, not the builder.

> **Renumbering (Tal 2026-10-06):** everything `docs/MULTIUSER.md` and `docs/STRATEGY.md` call "R16" / "Round 16 —
> product layer" is now **Round 17**. Round 16 = Tal's post-release notes. Supermarket → R18, price comparison → R19.
> Roadmap of record: `docs/PLANNER.md` ("Round 16 plan").

## Questions asked and Tal's answers (2026-10-06)
1. Scope: notes now + product layer later (chosen) · notes + admin/usage · everything in one round.
2. Mockups: in parallel — Session 1 now, Session 2 after approval (chosen) · mockups first.
3. Live sync: Ably free tier (chosen) · polling only.

## Causes found in code while planning
- Receipt prices wiped: `statusPatch()` (`src/app/actions.ts`) nulls `purchasedPrice` on → To buy; receipt items
  (`applyReceipt`) have no source, so that was their only price.
- "Move to" shows only "Remove from project": `selection-bar.tsx` lists only the current space's collections; a new
  shared space has none.
- Sidebar jump on space switch: `useSwitchSpace()` (`spaces/space-ui.tsx`) → `window.location.replace` = full reload.
- Overlapping menus: each `Menu` in the selection bar is independent (Radix roots, no shared open state).
- Receipt re-open: not reproduced; candidates in `receipt-dialog.tsx` (file input value never cleared, `phase` kept on
  open, waiting list may include applied receipts).
- Phone desktop-size after sign-in: layout is CSS `lg` breakpoint driven (`nexus-app.tsx` `useSyncExternalStore` on
  `(min-width:1024px)`); cause not found — reproduce through the redirect chain.
- Existing infra to build on: `client-errors.ts` (ring buffer of client errors + failed requests), `reports` table +
  report dialog, `scripts/reports.mjs`, `rateLimit` table (`src/lib/auth/limits.ts`), `/api/csp-report`,
  scoped data layer `src/lib/db-scoped/index.ts` (central `insert/update/delete` → where `rev` stamping goes).

## Traceability — Tal's notes (`docs/R16-NOTES.md`) → items
| Note | Item | Note | Item |
|---|---|---|---|
| 1 live sync | B1, B2, B4 | 13 phone logo size | A10 |
| 2 concurrent edits | B3 | 14 "+" sheet close stutter | A11 |
| 3 receipt prices wiped | A1 | 15 one-tap report | C1 |
| 4 receipt re-open | A2 | 16 automatic error log | C2 |
| 5 desktop quick actions | A3 | 17 desktop settings screen | D1 |
| 6 Move to empty | A4 | 18 space settings, no scroll | D2 |
| 7 overlapping menus | A5 | 19 phone overlays in sections | D3 |
| 8 checkbox always shown | A6 | 20 switch interstitial + land on Home | A12 (no reload, Home) + D4 |
| 9 sidebar jump on switch | A12 | 21 space identity + photo | D5 |
| 10 link failed (price/picture) | 0.1 + C2 (extract log) | 22 Home presets, sizes, indicators | E1, E2 |
| 11 phone desktop-size after sign-in | A8 | 23 suggestions swipe/drag | A7 |
| 12 sign-in gap + cubes cropped | A9 | 24 admin + usage data | **R17** (C2's `/admin/errors` is its seed) |
| H open report (price drop / AI) | A13 | H R15 Part G results | 0.1 |

## Research behind Part B (planner, 2026-10-06)
- Vercel Hobby can't hold open connections for long (functions end; SSE would burn the monthly compute allowance per open
  tab), so live updates need a hosted realtime service or polling.
- Compared free tiers: **Ably** — 6 M messages/month, 200 concurrent connections, 200 channels, no card, presence built in,
  token auth with per-channel capabilities (fits "one space = one channel, no content on the wire"). **Pusher** sandbox —
  200 k messages/day, 100 connections. Polling alone — no service, 3–10 s delay, no presence. Choice (Tal): Ably + polling
  fallback. Supabase Realtime / Cloudflare Durable Objects were not chosen (a second backend to run).
- Why a per-space `rev` and not timestamps: clocks differ between serverless instances; one counter bumped in the same
  transaction gives an exact "what changed since" and doubles as the optimistic-concurrency check (B3).

