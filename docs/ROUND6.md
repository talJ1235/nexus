# Round 6 brief (from Tal, 2026-10-01) — features — read this instead of the chat history

Six features, four sessions (one theme each). Quality bar as always; every UI part works on a phone.
**Visual polish is not the goal of this round**: a UI redesign (UI v2, `docs/UI-V2.md`) comes right after. Build new UI
only from existing components and tokens, no new one-off styles, so v2 can restyle it cheaply.
Follow CLAUDE.md "Session workflow". Mock mode (`NEXUS_AI_MOCK=1`) must cover every new AI path so smoke runs offline.

---

## Session B1 — assistant that can act

### 1. [x] Actions from the chat, always confirmed
Today "Ask" (`askNexus` in `src/lib/assistant.ts`, `ask` in `src/app/ai-actions.ts`) only answers. Wanted: "mark all
Railcam parts as ordered", "move everything from AliExpress to project X", "set the fan to urgent, qty 2" → the
assistant proposes the change, the user confirms, it happens, with undo.
- Provider-neutral (Gemini → Groq → OpenRouter fallback must keep working): no native function calling. The model
  appends one fenced block ` ```nexus-actions ` with JSON `{ "summary": string, "actions": Action[] }`; the server parses
  and validates it strictly. Invalid/unknown → dropped, the text answer still shows.
- Whitelist only (anything else is rejected server-side): `move` (itemIds → collectionId | unsorted),
  `setStatus` (to_buy | ordered | purchased), `setPriority`, `setQty`, `addTag` / `removeTag`, `createCollection`
  (name, kind, budget?). Max 50 items per proposal. **No deletes.** itemIds must exist and belong to the owner.
- UI: under the answer, a confirmation card: summary line + a compact list of affected items with before → after
  (e.g. "To buy → Ordered"), "Apply" / "Cancel". Apply runs through a new owner-only server action that re-validates
  everything (`assertOwner`) and reuses the existing item mutations; then a toast with Undo (restore previous values).
  Nothing ever runs without the click.
- Assistant is owner-only today; keep it that way (guests never get actions).
- Prompt: teach the format with 2 short examples; the model proposes actions only when the user asks for a change.
- Suggestions (`src/lib/assistant-suggestions.ts`) may add 1 action-style chip when it fits (e.g. many Unsorted →
  "Sort my unsorted items into projects").
Acceptance: unit test for the parser/validator (valid, unknown action, foreign id, >50 items, malformed JSON);
`SMOKE_WRITE` + mock: propose → apply → undo.

---

## Session B2 — money planning

### 2. [x] Free-shipping threshold per store
In "Order by store", show how far each store is from free shipping and how to get there.
- Per-store settings (new table `store_settings`: `storeKey` PK, `freeShippingMin` real null, `currency`,
  `shippingFee` real null, `updatedAt`; created idempotently in `src/db/migrate.ts`, included in backup/restore).
  Edited from the store group header (small popover). A few known defaults may be pre-filled but always editable.
- Group header: progress bar to the threshold ("₪23 more for free shipping" / "Free shipping ✓"), using the store's
  hue from `StoreMark`. Subtotal includes the store's shipping fee while under the threshold.
- Suggestions to close the gap, in order: (a) items to buy elsewhere that also have a source at this store (switch the
  chosen source; show the price difference), (b) "someday"/normal items from this store left out of the order.
  One click applies (switch source / include).
Acceptance: pure function for gap + suggestions with a unit test; smoke checks the bar renders.

### 3. [x] Monthly budget + forecast
- Setting: monthly spending cap (currency-aware, optional), in Settings and on the Spending view.
- Spending view, this month: spent (purchased) + committed (ordered) + a forecast (urgent to-buy, and normal to-buy
  if the user toggles it) against the cap: one bar with three segments + clear numbers. States: ok / near (≥90 %) /
  over. Previous months show spent vs the cap they had (store the cap history in kv per month).
- The existing Telegram digest adds one line when the month goes near/over the cap (once per state per month).
Acceptance: unit test for the forecast function; smoke renders the bar with seeded data.

---

## Session B3 — receipts → purchases

### 4. [ ] Upload a receipt or order confirmation, Nexus marks what was bought
- Entry points: a "Receipt" button in the add bar menu and in "On the way"/History; also drop a file on the app.
  Accepts image, PDF, or pasted email text. Files go to Vercel Blob with the existing client-upload flow.
- Extraction: Gemini (vision/PDF) returns structured JSON: store, order date, order number, currency, lines
  [{ name, qty, unitPrice, lineTotal }], shipping, total. Gemini-only is fine (other providers can't read images);
  if AI is unavailable, say so clearly and keep the file so it can be retried from the item/receipt later.
- Matching: each line → best candidate among to_buy/ordered items (store match + title similarity + price
  proximity; pure function with a score). Review screen: every line with its proposed match (changeable via search),
  qty, price paid; unmatched lines can be added as new purchased items or ignored.
- Confirm → set status (purchased, or ordered if the document is an order confirmation), price paid per unit,
  order number, date; attach the receipt to every matched item; price history point; toast with Undo.
Acceptance: unit test for the matcher (Hebrew + English titles, qty split, no match); mock-mode fixture receipt
end-to-end in `SMOKE_WRITE`.

---

## Session B4 — weekly digest + offline

### 5. [ ] Weekly Telegram summary
- Sent by the existing daily cron on Sundays (Israel week start; no new cron entry — Vercel Hobby limits).
- Content, short and scannable, Hebrew/English per the user's locale: price drops and targets hit this week; urgent
  items not ordered; orders overdue/arriving this week; stores close to free shipping; month vs budget. Each item
  links to `?item=<id>`. Skipped when there's nothing worth sending. Toggle in the Alerts panel (default on).
- Reuse the Telegram sender; test with `scripts/test-telegram.mjs` (extend it).

### 6. [ ] Works offline (read-only v1)
Today `public/sw.js` is intentionally network-only. Wanted: the list opens and reads with no signal (e.g. inside a
store).
- Service worker caches the app shell and static assets (versioned per build); the latest app data snapshot is kept
  on the device (IndexedDB) **for the owner only**, refreshed on every successful load, and deleted on logout.
  Guests and share pages stay network-only.
- Offline: the app renders from the snapshot with a clear "Offline — showing data from <time>" banner; editing
  controls are disabled with a tooltip. Back online → banner goes, data refreshes. (Queued offline edits: not in v1.)
- No stale app after deploys: new SW activates and reloads once on next open.
Acceptance: smoke with Playwright `context.setOffline(true)` after one online load: app renders from the snapshot,
banner visible, edits disabled; logout clears the snapshot.

---

## Open
- (B1) A proposal is all-or-nothing: one hallucinated id or unknown action drops the whole card (the text answer still
  shows). Stricter than filtering per action, so the summary always matches what Apply does.
- (B1) Undo restores the values from Apply time; edits made to the same items between Apply and Undo are overwritten.
- (B2) "Left out of the order" = someday items (Tal's pick): they no longer count in Order by store subtotals and are
  listed per store with "Include" (→ normal priority).
- (B2) Free-shipping thresholds compare against item lines as shown (per-item shipping from the store page included);
  the store's flat fee is added on top while under the threshold. Pre-filled defaults (Amazon $49, AliExpress $10,
  iHerb $45) are rough guesses — correct them from the popover.
- (B2) The budget line in the Telegram digest is covered by unit tests of its rules (state, once per state per month,
  Israel month boundaries) but was not sent end-to-end locally (no Telegram from the dev machine); watch the first
  real near/over month. B4's weekly summary can reuse `monthForecast` for "month vs budget".
