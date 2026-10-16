// R17 H acceptance — onboarding (R18 S5 F: nine steps — 1 why · 2 home · 3 stores · 4 habits · 5 food · 6 budget ·
// 7 install · 8 notifications · 9 done): a new person goes through all of them → the answers are saved, the shared space
// is made for "family", the budget is set (personal space, currency, supermarket share, start day), Home's preset
// follows "why"; Skip on step 1 → Home; reload on step 3 resumes there (and "/" sends an unfinished onboarding back);
// someone who joined through a space invite skips step 2; an iPhone shows the Add-to-Home-Screen guide and skips 8
// when not standalone; standalone skips 7; with reduced motion there's no confetti; the Home card's quick questions
// ask only 2, 4, 5, 6.
//   npm run build && npm run test:onboarding
import { chromium } from "playwright";
import { startApp } from "./lib/test-app.mjs";
import { PHONE_UA } from "./lib/phone.mjs";

let fails = 0;
const ok = (c, m, extra = "") => {
  console.log(`${c ? "PASS" : "FAIL"} ${m}${c ? "" : ` ${extra}`}`);
  if (!c) fails++;
};
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const app = await startApp({ db: "onboarding-test.db", port: Number(process.env.PORT || 3125) });
const browser = await chromium.launch();
const x = async (sql, args = []) => {
  for (let k = 0; ; k++) {
    try {
      return (await app.db.execute({ sql, args })).rows;
    } catch (e) {
      if (!/SQLITE_BUSY/.test(String(e)) || k > 20) throw e;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
};
const now = Date.now();
let n = 0;
async function person(opts = {}) {
  const id = `obu_${++n}`;
  await x(`INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at) VALUES (?, ?, ?, 1, 'user', ?, ?)`, [id, `Dana${n} Test`, `${id}@example.com`, now, now]);
  const s = await app.sessionFor(id, { locale: opts.he ? "he" : "en" });
  const ctx = await browser.newContext({
    viewport: opts.phone ? { width: 390, height: 844 } : { width: 1366, height: 768 },
    ...(opts.phone ? { isMobile: true, hasTouch: true, userAgent: PHONE_UA } : {}),
    ...(opts.ua ? { userAgent: opts.ua } : {}),
    reducedMotion: opts.reduce ? "reduce" : "no-preference",
  });
  await ctx.addCookies(s.cookies);
  if (opts.standalone) await ctx.addInitScript(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q.includes("display-mode: standalone") ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : mm(q));
  });
  if (opts.notifications) await ctx.grantPermissions(["notifications"], { origin: app.base });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  pageerror (${id}): ${String(e.message).slice(0, 200)}`));
  page.setDefaultTimeout(15_000);
  return { id, ctx, page };
}
const step = (p) => p.getAttribute("[data-ob-step]", "data-ob-step").then(Number, () => 0);
const waitStep = async (p, k) => {
  await p.waitForSelector(`[data-ob-step="${k}"]`, { timeout: 15_000 }).catch(() => {});
  return (await step(p)) === k;
};
const pref = async (id) => JSON.parse((await x("SELECT value FROM user_pref WHERE user_id = ? AND key = 'pref:onboarding'", [id]))[0]?.value ?? "null");
async function primary(p) {
  try {
    await p.click("[data-ob-primary]");
  } catch (e) {
    console.log(`  no primary at ${p.url()}: ${(await p.innerText("body").catch(() => "")).slice(0, 300).replace(/\s+/g, " ")}`);
    throw e;
  }
}
/** Continue; on step 3 the supermarket's chains phase (R18 S2 F2: nothing picked) takes one more Continue. */
async function forward(p) {
  const at = await step(p);
  await primary(p);
  if (at === 3) {
    await p.waitForSelector("[data-ob-chains]", { timeout: 5_000 }).then(() => primary(p), () => {});
  }
}
const settle = (p) => p.waitForLoadState("networkidle").catch(() => {});

try {
  // ---- The whole way (desktop, family, notifications granted; reduced motion: no confetti).
  {
    const { id, page: p } = await person({ notifications: true, reduce: true });
    await p.goto(`${app.base}/welcome`);
    ok(await waitStep(p, 1), "a new person starts at step 1");
    await p.click('[data-ob-why="super"]');
    await primary(p);
    ok(await waitStep(p, 2), "→ step 2 (your home)");
    await p.click('[data-ob-who="family"]');
    ok((await p.locator("[data-ob-shared]").count()) === 1, "family → the shared Home card with Invite");
    const kids0 = Number(await p.innerText('[data-ob-count-n="kids"]'));
    await p.click('[data-ob-count-more="kids"]');
    await p.click('[data-ob-count-more="pets"]');
    ok(Number(await p.innerText('[data-ob-count-n="kids"]')) === kids0 + 1 && (await p.locator(".ob5-p").count()) === 1, "F2 steppers count, the picture adds a pet", String(await p.locator(".ob5-fig").count()));
    await primary(p);
    ok(await waitStep(p, 3), "→ step 3 (stores)");
    await p.click('[data-ob-store="shufersal"]');
    await p.click('[data-ob-store="ikea"]');
    await p.fill("[data-store-search]", "Makolet Shalom");
    await p.click("[data-ob-add-store]");
    await primary(p);
    // R18 S2 F2: the supermarket's chains (Shufersal picked in the stores step = main), then its branch.
    await p.waitForSelector("[data-ob-chains]", { timeout: 10_000 }).catch(() => {});
    ok((await step(p)) === 3 && (await p.locator('[data-ob-chain="shufersal"] [data-ob-main]').count()) === 1, "F2 chains: Shufersal from the stores step is the main store");
    await p.click('[data-ob-chain="rami-levy"]');
    await primary(p);
    await p.waitForSelector("[data-ob-branch]", { timeout: 10_000 }).catch(() => {});
    ok(/Which Shufersal\?/.test(await p.innerText("body")), "F2 branch: Which Shufersal?");
    await p.fill("[data-ob-branch-input]", "Herzl St.");
    await primary(p);
    ok(await waitStep(p, 4), "→ step 4 (how you shop)");
    await p.click('[data-ob-freq="twice"]');
    await p.click('[data-ob-day="0"]');
    await p.click('[data-ob-day="3"]');
    await p.click('[data-ob-mode="both"]');
    ok(/evening before Su/.test(await p.innerText("[data-ob-habits-scene]")), "F3: the week lights the days, ready the evening before", await p.innerText("[data-ob-habits-scene]").catch(() => ""));
    await primary(p);
    ok(await waitStep(p, 5), "→ step 5 (food at home)");
    await p.click('[data-ob-diet="vegetarian"]');
    await p.click('[data-ob-diet="kosher"]');
    await p.click("[data-ob-shabbat]");
    ok((await p.locator("[data-ob-food-scene] .ob5-tag").count()) === 3, "F4: the plate shows the choices");
    await primary(p);
    ok(await waitStep(p, 6), "→ step 6 (budget)");
    await p.click("[data-ob-cur]");
    await p.fill("[data-ob-budget]", "2750");
    await p.$eval("[data-ob-sm-share]", (el) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "1200");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await p.click('[data-ob-start="10"]');
    await primary(p);
    // R17 S5 S4: headless Chromium can't install → on a computer step 7 still shows, with only the phone's QR.
    ok(await waitStep(p, 7), "→ step 7 on a computer that can't install", String(await step(p)));
    ok((await p.locator('[data-ob-install="phone"]').count()) === 1 && (await p.locator("[data-ob-phone-qr]").count()) === 1 && (await p.locator(".card").filter({ hasText: "On this computer" }).count()) === 0, "S4 step 7: only the \"On your phone\" QR card", await p.innerText("[data-ob-step]").catch(() => ""));
    ok((await p.innerText("[data-ob-primary]")).trim().startsWith("Continue"), "S4 step 7 (phone QR only): Continue", await p.innerText("[data-ob-primary]").catch(() => ""));
    await primary(p);
    ok(await waitStep(p, 8), "→ step 8 (notifications are allowed for this context)");
    await primary(p);
    await p.waitForSelector('[data-ob-notif="granted"]', { timeout: 10_000 }).catch(() => {});
    ok((await p.locator('[data-ob-notif="granted"]').count()) === 1, "Turn on notifications → granted (asked only on that tap)");
    await primary(p);
    ok(await waitStep(p, 9), "→ step 9 (done)");
    ok(/people/.test(await p.innerText("[data-ob-sum-home]").catch(() => "")) && /Twice a week/.test(await p.innerText("[data-ob-sum-habits]").catch(() => "")), "F1: the done screen sums up the home and habits", await p.innerText("[data-ob-summary]").catch(() => ""));
    const conf = await p.evaluate(() => [...document.querySelectorAll(".conf")].filter((c) => getComputedStyle(c).display !== "none").length);
    ok(conf === 0, "reduced motion: no confetti", String(conf));
    ok(/Minimal/.test(await p.innerText("[data-ob-summary]")), "the done screen says what Home starts with (supermarket → Minimal)", await p.innerText("[data-ob-summary]").catch(() => ""));
    await primary(p);
    await p.waitForURL((u) => u.pathname === "/", { timeout: 20_000 }).catch(() => {});
    ok(new URL(p.url()).pathname === "/", "Go to Home → Home", p.url());
    await settle(p);
    const o = await pref(id);
    ok(o?.status === "done" && o.why.join() === "super" && o.stores.includes("shufersal") && o.stores.includes("custom:Makolet Shalom") && o.who === "family" && o.notif === "granted" && o.kids === kids0 + 1 && o.pets === 1 && o.freq === "twice" && o.days.join() === "0,3" && o.mode === "both" && o.diet.includes("vegetarian") && o.shabbat === true && o.startDay === 10 && o.smShare === 1200, "answers saved in pref:onboarding (F2–F5 fields too)", JSON.stringify(o));
    const personal = (await x("SELECT id, currency FROM space WHERE kind = 'personal' AND created_by = ?", [id]))[0];
    const st = await x("SELECT chain, branch, is_default FROM space_store WHERE space_id = ? ORDER BY is_default DESC, chain", [personal.id]);
    ok(JSON.stringify(st.map((r) => [r.chain, r.branch, Number(r.is_default)])) === JSON.stringify([["shufersal", "Herzl St.", 1], ["rami-levy", "", 0]]), "F2: main store + branch and the other chain saved for the space", JSON.stringify(st));
    const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" }).format(Date.now());
    const budget = (await x("SELECT value FROM space_pref WHERE space_id = ? AND key = ?", [personal.id, `pref:budget:${month}`]))[0]?.value;
    ok(personal.currency === "USD" && JSON.parse(budget ?? "{}").cap === 2750 && JSON.parse(budget ?? "{}").currency === "USD", "budget 2,750 $ set on the personal space", `${personal.currency} ${budget}`);
    const sp = Object.fromEntries((await x("SELECT key, value FROM space_pref WHERE space_id = ? AND key IN ('pref:budget-start', 'pref:budget-sm', 'pref:home-food')", [personal.id])).map((r) => [r.key, r.value]));
    ok(sp["pref:budget-start"] === "10" && sp["pref:budget-sm"] === "1200" && JSON.parse(sp["pref:home-food"] ?? "{}").shabbat === true, "F4 / F5: start day, supermarket share and food choices on the space", JSON.stringify(sp));
    const shared = await x("SELECT s.name, s.color, m.role FROM space s JOIN space_member m ON m.space_id = s.id WHERE s.kind = 'shared' AND m.user_id = ?", [id]);
    ok(shared.length === 1 && shared[0].name === "Home" && shared[0].color === "green" && shared[0].role === "owner", "the shared space \"Home\" (green) was made", JSON.stringify(shared));
    const layout = (await x("SELECT value FROM user_pref WHERE user_id = ? AND key = ?", [id, `pref:home:layout:${personal.id}`]))[0]?.value;
    ok(JSON.parse(layout ?? "{}").preset === "minimal", "Home's preset follows the answer", layout);
    ok((await x("SELECT sum(n) n FROM activity WHERE user_id = ? AND kind = 'onboarding_step'", [id]))[0].n >= 5, "onboarding steps counted for the admin's Live (counts only)");
  }

  // ---- Skip on step 1 → Home.
  {
    const { id, page: p } = await person({ phone: true });
    await p.goto(`${app.base}/welcome`);
    await waitStep(p, 1);
    await p.click("[data-ob-skip]");
    await p.waitForURL((u) => u.pathname === "/", { timeout: 20_000 }).catch(() => {});
    ok(new URL(p.url()).pathname === "/" && (await pref(id))?.status === "skipped", "Skip on step 1 → Home (skipped)", p.url());
  }

  // ---- Reload on step 3 resumes; "/" sends an unfinished onboarding back.
  {
    const { id, page: p } = await person({ phone: true });
    await p.goto(`${app.base}/welcome`);
    await waitStep(p, 1);
    await primary(p);
    await waitStep(p, 2);
    await primary(p);
    await waitStep(p, 3);
    await settle(p);
    // The step is saved as it is left — wait for it before reloading.
    for (let k = 0; k < 40 && (await pref(id))?.step !== 3; k++) await p.waitForTimeout(150);
    await p.reload();
    ok(await waitStep(p, 3), "reload on step 3 → step 3", `at ${await step(p)} · chains ${await p.locator("[data-ob-chains]").count()}`);
    await p.goto(`${app.base}/`);
    ok(new URL(p.url()).pathname === "/welcome" && (await waitStep(p, 3)), "\"/\" while unfinished → back to step 3", p.url());
  }

  // ---- Joined through a space invite: step 2 (who / your home) is skipped.
  {
    const { id, page: p } = await person({ notifications: true });
    await x("INSERT INTO space (id, name, slug, kind, currency, color, icon, created_by, created_at) VALUES ('ob_sp', 'Cohen home', 's-ob-sp', 'shared', 'ILS', 'blue', 'home', ?, ?)", [app.admin, now]);
    await x("INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES ('ob_m', 'ob_sp', ?, 'member', ?)", [id, now]);
    await p.goto(`${app.base}/welcome`);
    await waitStep(p, 1);
    await primary(p);
    await p.waitForTimeout(800);
    const s = await step(p);
    ok(s === 3, "joined through a space invite → step 2 skipped (1 → 3)", String(s));
  }

  // ---- iPhone (Safari, not on the Home Screen): the guide on 7, step 8 skipped.
  {
    const { page: p } = await person({ phone: true, ua: IPHONE });
    await p.goto(`${app.base}/welcome`);
    await waitStep(p, 1);
    for (const k of [1, 2, 3, 4, 5, 6]) {
      await forward(p);
      await waitStep(p, k + 1);
    }
    ok((await step(p)) === 7 && (await p.locator("[data-ob-iphone-guide]").count()) === 1, "iPhone: step 7 is the Add-to-Home-Screen guide", String(await step(p)));
    await primary(p);
    ok(await waitStep(p, 9), "iPhone not standalone: \"I added it\" → done (step 8 skipped)", String(await step(p)));
  }

  // ---- R17 S5 S4: a computer where the browser offers install: both cards (this computer + the phone QR), Install + Not now.
  {
    const { page: p } = await person({});
    await p.goto(`${app.base}/welcome`);
    await waitStep(p, 1);
    await p.evaluate(() => {
      const e = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(e, { prompt: async () => {}, userChoice: Promise.resolve({ outcome: "dismissed" }) });
      window.dispatchEvent(e);
    });
    for (const k of [1, 2, 3, 4, 5, 6]) {
      await forward(p);
      await waitStep(p, k + 1);
    }
    ok((await step(p)) === 7 && (await p.locator('[data-ob-install="both"]').count()) === 1 && (await p.locator("[data-ob-phone-qr]").count()) === 1, "S4 desktop that can install: step 7 with both cards", String(await step(p)));
    ok((await p.locator("[data-ob-later]").count()) === 1 && /Install/i.test(await p.innerText("[data-ob-primary]")), "S4 desktop that can install: Install + Not now", await p.innerText("[data-ob-primary]").catch(() => ""));
    await p.click("[data-ob-later]");
    ok(await waitStep(p, 8), "S4 Not now → step 8", String(await step(p)));
  }

  // ---- Standalone (already installed): step 7 skipped.
  {
    const { page: p } = await person({ phone: true, standalone: true, notifications: true });
    await p.goto(`${app.base}/welcome`);
    await waitStep(p, 1);
    for (const k of [1, 2, 3, 4, 5]) {
      await forward(p);
      await waitStep(p, k + 1);
    }
    await primary(p);
    ok(await waitStep(p, 8), "standalone: step 6 → 8 (install skipped)", String(await step(p)));
  }

  // ---- R18 S5 F1: someone who finished before S5 — the Home card opens the quick questions (2, 4, 5, 6) once.
  {
    const { id, page: p } = await person({ phone: true });
    await x("INSERT OR REPLACE INTO user_pref (user_id, key, value) VALUES (?, 'pref:onboarding', ?)", [id, JSON.stringify({ v: 1, status: "done", step: 7, why: ["super"], stores: [], custom: [], budget: null, currency: "ILS", who: "me", sharedSpaceId: null, notif: null, installed: false, at: now })]);
    await p.goto(`${app.base}/`);
    await p.waitForSelector("[data-home-quick]", { timeout: 20_000 }).catch(() => {});
    ok((await p.locator("[data-home-quick]").count()) === 1, "F1: an old finished onboarding → the \"3 quick questions\" Home card");
    await p.click("[data-home-quick-go]");
    ok(await waitStep(p, 2), "the card opens step 2", p.url());
    const seen = [];
    for (let k = 0; k < 6; k++) {
      const before = await step(p);
      if (!before) break;
      seen.push(before);
      await primary(p);
      await p.waitForFunction((b) => Number(document.querySelector("[data-ob-step]")?.getAttribute("data-ob-step") ?? 0) !== b, before, { timeout: 8_000 }).catch(() => {});
      if (new URL(p.url()).pathname === "/") break;
    }
    await p.waitForURL((u) => u.pathname === "/", { timeout: 20_000 }).catch(() => {});
    ok(seen.join() === "2,4,5,6" && new URL(p.url()).pathname === "/", "quick: 2 → 4 → 5 → 6 → Home", `${seen.join()} · ${p.url()}`);
    await settle(p);
    const o = await pref(id);
    ok(o?.status === "done" && o.quick === "done", "quick answers saved, onboarding stays done", JSON.stringify(o));
    await p.reload();
    await p.waitForSelector("[data-home]", { timeout: 20_000 }).catch(() => {});
    await p.waitForTimeout(800);
    ok((await p.locator("[data-home-quick]").count()) === 0, "the card is gone after answering");
  }
} finally {
  if (fails) console.log(app.log().split(String.fromCharCode(10)).filter((l) => /error|⨯/i.test(l)).slice(-15).join(" || "));
  await browser.close();
  app.stop();
}
console.log(fails ? `FAIL onboarding: ${fails}` : "OK onboarding");
process.exit(fails ? 1 : 0);
