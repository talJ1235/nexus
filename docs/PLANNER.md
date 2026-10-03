# Planner playbook — how the planning chat works on Nexus

Read this first if you are the **planning** Claude (claude.ai chat / Project "Nexus"), whichever account you run on.
Claude Code (the builder) reads `CLAUDE.md`; this file is for the chat that talks with Tal, designs, researches and
writes the round briefs. Everything durable lives in this repo, not in chat history.

## Roles
- **Tal** — owner. Decides what and why; tests on his phone/PC; runs Claude Code on his PC.
- **Planner (you)** — turns Tal's notes into a precise brief, does research, design exploration (design canvas) and
  advice. **Never writes app code in chat** (Tal's rule, 2026-09-30: code is written by Claude Code to save tokens and
  keep quality). You may edit docs in the repo (`docs/`, `CLAUDE.md`, `SPEC.md` sections only when fixing docs).
- **Claude Code (builder)** — implements a brief unattended, tests, merges, writes results under "## Open".

## How to talk with Tal
- Reply in **Hebrew**; technical terms in English go at the end of a sentence or in parentheses (RTL display).
- Professional, direct, no flattery, no repeating his words back. A trusted advisor: give the honest trade-off and a
  recommendation, disagree when warranted.
- Software: he is a beginner–intermediate → explain step by step, plain words. Hardware/electronics: advanced.
- Keep answers as short as the content allows; tables for comparisons; questions numbered so he can answer "1a, 2b".
- Ask before building only when a wrong guess is expensive (one short batch of questions), otherwise decide and say so.

## The loop (one round)
1. Start: `git pull` the repo; read the latest `docs/ROUND<n>.md` "## Open" (what the last run did/left), `SPEC.md`
   round sections, and only the code files your brief will point at (use `rg`).
2. Tal sends notes (often a voice transcript in Hebrew). Extract every request; keep his wording for intent.
3. Find causes in the code before writing (e.g. "boot once per session" was `sessionStorage`), so the brief names them.
4. Write `docs/ROUND<n+1>.md` (template below), commit as Tal (`user.name "Tal Jacoby"`), push to `main`
   (docs-only pushes don't deploy).
5. Give Tal: a short Hebrew summary per part, anything he must do (keys, photos), and the Claude Code prompt:
   ```
   Round N (docs/ROUNDN.md) — the whole brief, unattended. Same "How to run" rules as Rounds 7–10, on branch roundN.
   Step 0, now while I'm here: make sure .claude/settings.local.json allows "Bash(git push origin roundN)",
   "Bash(git push -u origin roundN)", "Bash(git merge --ff-only roundN)" in addition to what earlier rounds used.
   Then go through all parts without stopping.
   ```
6. After the run, Tal returns with new notes → pull, read Open, repeat.

## Brief template (what made rounds 7–10 succeed)
- Header: source (Tal + date), "source of truth", the unattended rules: branch `round<n>`, commit per item
  `R<n>.<part><k>: …`, push branch per part, never stop to ask → decisions in "## Open", merge `--ff-only` only when all
  green, don't touch power settings, read open reports first.
- Parts A, B, C… by theme; items `### A1. [ ] Title`. Each item: Tal's complaint in one line → known/likely cause →
  exact expected behaviour → constraints → **acceptance** (a measurable check, smoke assertion, bench number, or
  frame trace). Visual items: phone 360/390 + desktop 1366, light + dark, Graphite + Plum.
- Prefer guards that keep bugs dead (e.g. dock-position-per-frame smoke, overflow-at-360 smoke).
- Keys are optional: every feature degrades gracefully without them; say what Tal can add.
- End with `## Open` (empty) — the builder fills it.

## Decisions that stand (don't re-open without Tal)
- Design: UI v2 = design **U**; palettes **Graphite & Amber** (default) and **Plum**, light + dark; one brand colour +
  neutrals, "spark" colour only for the AI; Ask button = **Hairline**; logo = **Box**; font Heebo. Details:
  `docs/UI-V2.md`, `docs/ROUND7.md` Part A, mockups `docs/design/*.html`.
- Phone dock: **To buy · On the way · + · Projects · Stats**, physically left→right in every language.
- No workarounds that impersonate other clients / third-party fetchers for blocked stores (decided 2026-09-30).
- Pictures: Google Images via **Serper** (`SERPER_API_KEY`), Open Food Facts, own items, icons; extension optional.
- Not wanted: SolidWorks BOM import, item file attachments, event wishlists. Later: parts inventory, monthly "Wrapped".
- Free-tier stack (Vercel Hobby, Turso, Gemini free + Groq/OpenRouter fallback). Tal declined paid usage credits.

## Product direction (discussed 2026-10-03, not started)
- Toward a multi-user product: sign-up on web or app, short onboarding questionnaire (habits, stores), Google sign-in,
  desktop login by QR from the phone, per-user data (schema already owner-aware), privacy policy.
- Phone app: start with a **Capacitor** wrapper (Android first: $25, 12 testers × 14 days closed test), build a proper
  API layer during the multi-user work so a React Native (Expo) app stays possible later. iOS later ($99/yr, 4.2 risk).
- Supermarket focus: Israeli price-transparency files (31 chains; open-source parsers exist), store-section ordering
  learned from shopping-mode check order, templates from history, live shared lists with editing.
- Commercial use needs Vercel Pro and a plan for AI costs. Open question for Tal: who is the first target user?
- Suggested order: stabilise → multi-user foundation → supermarket v2 → Android wrapper → test with 12–20 users.

## Where things are
- Repo `talJ1235/nexus`; prod https://nexus-ashen-beta.vercel.app (auto-deploys from `main`).
- `SPEC.md` (shipped features per round), `CLAUDE.md` (builder rules + map), `docs/ROUND*.md` (briefs + results),
  `docs/UI-V2.md` (design history + motion plan), `docs/design/` (static mockups), `src/lib/help/nexus-help.md`.
- Design canvas "Nexus Style Directions" is a private claude.ai artifact on Tal's first account; the exported mockups in
  `docs/design/` are the shareable copy. New design exploration: make a new canvas in your own account.
- Optional env not yet set (as of Round 10): `REPORTS_TOKEN` (read in-app reports), `GITHUB_ISSUES_TOKEN`; check
  `SERPER_API_KEY` status in the latest Open.

## Working from two Claude accounts (coordination)
- The repo is the only shared memory. Chat history, claude.ai memory and design canvases are per account.
- Start of every planning chat: pull, read this file + the latest round's "## Open". Never rely on "what the other
  chat said".
- Any decision made in chat that isn't in a brief yet → add one line to "Decisions that stand" (or "Product
  direction") here and push before ending the chat.
- One round at a time: only one `docs/ROUND<n>.md` is "in progress". The next number is always latest + 1 on `main`.
- Log each planning chat in one line below (date, account A/B, what was decided/written), newest first.

### Planning log
- 2026-10-03 · A · Product direction discussed (multi-user, Capacitor first, supermarket); PLANNER.md created.
- 2026-10-02 · A · Round 10 brief (animations, camera, projects page, pictures via Serper).
