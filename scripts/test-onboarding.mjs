// R17 H acceptance — onboarding: a new person goes through all 7 steps → the answers are saved, the shared space is
// made for "with family", the budget is set (personal space, currency), Home's preset follows "why"; Skip on step 1 →
// Home; reload on step 3 resumes there (and "/" sends an unfinished onboarding back); someone who joined through a
// space invite skips step 4; an iPhone shows the Add-to-Home-Screen guide and skips 6 when not standalone; standalone
// skips 5; with reduced motion there's no confetti.
//   npm run build && npm run test:onboarding
import { chromium } from "playwright";
import { startApp } from "./lib/test-app.mjs";

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
    ...(opts.phone ? { isMobile: true, hasTouch: true } : {}),
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
const settle = (p) => p.waitForLoadState("networkidle").catch(() => {});

try {
  // ---- The whole way (desktop, family, notifications granted; reduced motion: no confetti).
  {
    const { id, page: p } = await person({ notifications: true, reduce: true });
    await p.goto(`${app.base}/welcome`);
    ok(await waitStep(p, 1), "a new person starts at step 1");
    await p.click('[data-ob-why="super"]');
    await primary(p);
    ok(await waitStep(p, 2), "→ step 2 (stores)");
    await p.click('[data-ob-store="shufersal"]');
    await p.click('[data-ob-store="ikea"]');
    await p.fill("[data-store-search]", "Makolet Shalom");
    await p.click("[data-ob-add-store]");
    await primary(p);
    ok(await waitStep(p, 3), "→ step 3 (budget)");
    await p.click("[data-ob-more]");
    await p.click('[data-ob-cur="USD"]');
    await primary(p);
    ok(await waitStep(p, 4), "→ step 4 (who)");
    await p.click('[data-ob-who="family"]');
    ok((await p.locator("[data-ob-shared]").count()) === 1, "family → the shared Home card with Invite");
    await primary(p);
    // R17 S5 S4: headless Chromium can't install → on a computer step 5 still shows, with only the phone's QR.
    ok(await waitStep(p, 5), "→ step 5 on a computer that can't install", String(await step(p)));
    ok((await p.locator('[data-ob-install="phone"]').count()) === 1 && (await p.locator("[data-ob-phone-qr]").count()) === 1 && (await p.locator(".card").filter({ hasText: "On this computer" }).count()) === 0, "S4 step 5: only the \"On your phone\" QR card", await p.innerText("[data-ob-step]").catch(() => ""));
    ok((await p.innerText("[data-ob-primary]")).trim().startsWith("Continue"), "S4 step 5 (phone QR only): Continue", await p.innerText("[data-ob-primary]").catch(() => ""));
    await primary(p);
    ok(await waitStep(p, 6), "→ step 6 (notifications are allowed for this context)");
    await primary(p);
    await p.waitForSelector('[data-ob-notif="granted"]', { timeout: 10_000 }).catch(() => {});
    ok((await p.locator('[data-ob-notif="granted"]').count()) === 1, "Turn on notifications → granted (asked only on that tap)");
    await primary(p);
    ok(await waitStep(p, 7), "→ step 7 (done)");
    const conf = await p.evaluate(() => [...document.querySelectorAll(".conf")].filter((c) => getComputedStyle(c).display !== "none").length);
    ok(conf === 0, "reduced motion: no confetti", String(conf));
    ok(/Minimal/.test(await p.innerText("[data-ob-summary]")), "the done screen says what Home starts with (supermarket → Minimal)", await p.innerText("[data-ob-summary]").catch(() => ""));
    await primary(p);
    await p.waitForURL((u) => u.pathname === "/", { timeout: 20_000 }).catch(() => {});
    ok(new URL(p.url()).pathname === "/", "Go to Home → Home", p.url());
    await settle(p);
    const o = await pref(id);
    ok(o?.status === "done" && o.why.join() === "super" && o.stores.includes("shufersal") && o.stores.includes("custom:Makolet Shalom") && o.who === "family" && o.notif === "granted", "answers saved in pref:onboarding", JSON.stringify(o));
    const personal = (await x("SELECT id, currency FROM space WHERE kind = 'personal' AND created_by = ?", [id]))[0];
    const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" }).format(Date.now());
    const budget = (await x("SELECT value FROM space_pref WHERE space_id = ? AND key = ?", [personal.id, `pref:budget:${month}`]))[0]?.value;
    ok(personal.currency === "USD" && JSON.parse(budget ?? "{}").cap === 2750 && JSON.parse(budget ?? "{}").currency === "USD", "budget 2,750 $ set on the personal space", `${personal.currency} ${budget}`);
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
    const { page: p } = await person({ phone: true });
    await p.goto(`${app.base}/welcome`);
    await waitStep(p, 1);
    await primary(p);
    await waitStep(p, 2);
    await primary(p);
    await waitStep(p, 3);
    await settle(p);
    await p.reload();
    ok(await waitStep(p, 3), "reload on step 3 → step 3");
    await p.goto(`${app.base}/`);
    ok(new URL(p.url()).pathname === "/welcome" && (await waitStep(p, 3)), "\"/\" while unfinished → back to step 3", p.url());
  }

  // ---- Joined through a space invite: step 4 is skipped.
  {
    const { id, page: p } = await person({ notifications: true });
    await x("INSERT INTO space (id, name, slug, kind, currency, color, icon, created_by, created_at) VALUES ('ob_sp', 'Cohen home', 's-ob-sp', 'shared', 'ILS', 'blue', 'home', ?, ?)", [app.admin, now]);
    await x("INSERT INTO space_member (id, space_id, user_id, role, created_at) VALUES ('ob_m', 'ob_sp', ?, 'member', ?)", [id, now]);
    await p.goto(`${app.base}/welcome`);
    await waitStep(p, 1);
    for (const k of [1, 2]) {
      await primary(p);
      await waitStep(p, k + 1);
    }
    await primary(p);
    await p.waitForTimeout(800);
    const s = await step(p);
    ok(s !== 4 && s > 3, "joined through a space invite → step 4 skipped", String(s));
  }

  // ---- iPhone (Safari, not on the Home Screen): the guide on 5, step 6 skipped.
  {
    const { page: p } = await person({ phone: true, ua: IPHONE });
    await p.goto(`${app.base}/welcome`);
    await waitStep(p, 1);
    for (const k of [1, 2, 3, 4]) {
      await primary(p);
      await waitStep(p, k + 1);
    }
    ok((await step(p)) === 5 && (await p.locator("[data-ob-iphone-guide]").count()) === 1, "iPhone: step 5 is the Add-to-Home-Screen guide", String(await step(p)));
    await primary(p);
    ok(await waitStep(p, 7), "iPhone not standalone: \"I added it\" → done (step 6 skipped)", String(await step(p)));
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
    for (const k of [1, 2, 3, 4]) {
      await primary(p);
      await waitStep(p, k + 1);
    }
    ok((await step(p)) === 5 && (await p.locator('[data-ob-install="both"]').count()) === 1 && (await p.locator("[data-ob-phone-qr]").count()) === 1, "S4 desktop that can install: step 5 with both cards", String(await step(p)));
    ok((await p.locator("[data-ob-later]").count()) === 1 && /Install/i.test(await p.innerText("[data-ob-primary]")), "S4 desktop that can install: Install + Not now", await p.innerText("[data-ob-primary]").catch(() => ""));
    await p.click("[data-ob-later]");
    ok(await waitStep(p, 6), "S4 Not now → step 6", String(await step(p)));
  }

  // ---- Standalone (already installed): step 5 skipped.
  {
    const { page: p } = await person({ phone: true, standalone: true, notifications: true });
    await p.goto(`${app.base}/welcome`);
    await waitStep(p, 1);
    for (const k of [1, 2, 3]) {
      await primary(p);
      await waitStep(p, k + 1);
    }
    await primary(p);
    ok(await waitStep(p, 6), "standalone: step 4 → 6 (install skipped)", String(await step(p)));
  }
} finally {
  if (fails) console.log(app.log().split(String.fromCharCode(10)).filter((l) => /error|⨯/i.test(l)).slice(-15).join(" || "));
  await browser.close();
  app.stop();
}
console.log(fails ? `FAIL onboarding: ${fails}` : "OK onboarding");
process.exit(fails ? 1 : 0);
