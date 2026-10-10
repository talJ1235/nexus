// R17 P1 + P2 guard — mixed Hebrew / English reads in the right order, and user-written names are cut at their end.
//   1. Switcher (P1): the sidebar's space switcher with the names "Jacoby Home", "בית יעקובי", a 40-letter Latin and a
//      40-letter Hebrew name, English + Hebrew UI, at the sidebar's own width and forced to 232 px: the name's first
//      letter is on screen (the ellipsis eats the END), the name keeps ≥ 8 letters of room next to the faces, and the
//      switcher's box — open (its pressed / selected background) and focused (its ring) — isn't cut by any ancestor.
//   2. Hebrew walk (P2, the test:clip screens in Hebrew, phone 390 + desktop 1366): every visible element whose text
//      starts with a Hebrew letter has `direction: rtl`, and in every text node whose first letter is Hebrew a Latin word
//      that follows a Hebrew word on the same line is to its LEFT (DOM Range rects) — "תכנון עם Nexus", not "Nexus תכנון עם".
// Usage: npm run build, then `npm run test:bidi` (PORT=3111). BIDI_ONLY=switcher,walk
import { chromium } from "playwright";
import { seedAdmin } from "./lib/seed-admin.mjs";
import { seedInbox } from "./lib/seed-notify.mjs";
import { startApp } from "./lib/test-app.mjs";

const PORT = Number(process.env.PORT || 3111);
const ONLY = (process.env.BIDI_ONLY || "").split(",").filter(Boolean);
const want = (g) => !ONLY.length || ONLY.includes(g);
const app = await startApp({ db: "bidi-test.db", port: PORT });
const BASE = app.base;
await seedAdmin(app.db, { adminId: app.admin, personal: app.personal });
for (const sp of [app.personal, "pa_big"]) await seedInbox(app.db, { userId: app.admin, spaceId: sp });

const browser = await chromium.launch();
const fails = [];
const fail = (where, msg) => fails.push(`${where}: ${msg}`);
const boot = async ({ w, h, phone, locale, space }) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  ctx.setDefaultTimeout(30_000);
  await ctx.addCookies(app.cookies(space, locale));
  await ctx.addInitScript(() => {
    try {
      sessionStorage.setItem("nexus.opened", "1");
      const d = new Date();
      localStorage.setItem("nexus.bootDay", `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
    } catch {}
  });
  return { ctx, page: await ctx.newPage() };
};
const settle = async (page) => {
  await page.waitForSelector("[data-app-shell][data-ready]", { timeout: 30_000 });
  await page.waitForTimeout(350);
};

// ---------- 1. Switcher ----------
if (want("switcher")) {
  const NAMES = ["Jacoby Home", "בית יעקובי", "The Jacoby family home on Herzl street 42", "בית משפחת יעקובי ברחוב הרצל ארבעים ושתיים"];
  const orig = (await app.db.execute("SELECT name FROM space WHERE id = 'pa_big'")).rows[0].name;
  for (const name of NAMES) {
    await app.db.execute({ sql: "UPDATE space SET name = ? WHERE id = 'pa_big'", args: [name] });
    for (const locale of ["en", "he"])
      for (const width of [null, 232]) {
        const { ctx, page } = await boot({ w: 1366, h: 768, locale, space: "pa_big" });
        await page.goto(BASE + "/");
        await settle(page);
        if (width) await page.evaluate((px) => {
          const nav = document.querySelector("nav[aria-label=Main]");
          for (let n = nav; n && n !== document.body; n = n.parentElement) if (n.getBoundingClientRect().width < 300) n.style.width = `${px}px`;
        }, width);
        await page.waitForTimeout(100);
        const where = `switcher ${locale} ${width ?? "own"} px "${name.slice(0, 14)}…"`;
        const r = await page.evaluate(() => {
          const btn = document.querySelector("[data-space-switcher]");
          const b = btn.querySelector("b");
          const box = b.getBoundingClientRect();
          const t = b.firstChild;
          const first = document.createRange();
          first.setStart(t, 0);
          first.setEnd(t, 1);
          const fr = first.getBoundingClientRect();
          const cut = b.scrollWidth > b.clientWidth + 0.5;
          // Room for the name: its box against 8 average letters of its font.
          const cs = getComputedStyle(b);
          const probe = document.createElement("span");
          probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font}`;
          probe.textContent = "abcdefgh";
          document.body.append(probe);
          const eight = probe.getBoundingClientRect().width;
          probe.remove();
          return { firstIn: fr.left >= box.left - 0.5 && fr.right <= box.right + 0.5, cut, room: box.width, eight, sidebar: btn.closest("nav").getBoundingClientRect().width };
        });
        if (!r.firstIn) fail(where, `the name's first letter is cut (${r.cut ? "ellipsis on the wrong end" : "off its box"})`);
        if (r.room < r.eight - 1) fail(where, `the name has ${Math.round(r.room)} px, under 8 letters (${Math.round(r.eight)} px) at a ${Math.round(r.sidebar)} px sidebar`);
        // Its box, open and focused, against every ancestor that hides overflow.
        const clipped = async (state, grow) =>
          page.evaluate(
            ({ grow }) => {
              const btn = document.querySelector("[data-space-switcher]");
              const r = btn.getBoundingClientRect();
              const want = { l: r.left - grow, r: r.right + grow, t: r.top - grow, b: r.bottom + grow };
              for (let n = btn.parentElement; n && n !== document.documentElement; n = n.parentElement) {
                const s = getComputedStyle(n);
                if (s.overflowX === "visible" && s.overflowY === "visible") continue;
                const a = n.getBoundingClientRect();
                if (want.l < a.left - 0.5 || want.r > a.right + 0.5 || want.t < a.top - 0.5 || want.b > a.bottom + 0.5) return `${n.tagName.toLowerCase()}${n.className ? "." + String(n.className).split(" ").slice(0, 3).join(".") : ""}`;
              }
              const cs = getComputedStyle(btn);
              const radii = new Set([cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius]);
              return radii.size > 1 ? `uneven corners ${[...radii].join("/")}` : null;
            },
            { grow },
          ).then((by) => by && fail(where, `the switcher's ${state} box is cut by ${by}`));
        await page.click("[data-space-switcher]");
        await page.waitForTimeout(200);
        await clipped("open", 0);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(150);
        await page.evaluate(() => document.querySelector("[data-space-switcher]").blur());
        await page.focus("[data-space-switcher]");
        // The focus ring: 2 px outline 2 px out (globals.css :focus-visible).
        await clipped("focus ring", 4);
        await ctx.close();
      }
  }
  await app.db.execute({ sql: "UPDATE space SET name = ? WHERE id = 'pa_big'", args: [orig] });
}

// ---------- 2. Hebrew walk ----------
/** In the page: Hebrew text with a non-RTL base, and Latin words that sit on the wrong side of the Hebrew before them. */
function scan(rootSel) {
  const out = [];
  const roots = rootSel ? [...document.querySelectorAll(rootSel)] : [document.body];
  const HE = /[֐-׿]/;
  const firstStrong = (s) => s.match(/[A-Za-zÀ-ɏ֐-׿؀-ۿ]/)?.[0] ?? "";
  const where = (e) => {
    const parts = [];
    for (let n = e; n && n !== document.body && parts.length < 4; n = n.parentElement) {
      const d = [...n.attributes].find((a) => a.name.startsWith("data-") && a.name !== "data-state");
      parts.unshift(n.tagName.toLowerCase() + (d ? `[${d.name}${d.value && d.value.length < 24 ? `=${d.value}` : ""}]` : ""));
    }
    return parts.join(" > ");
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  };
  for (const root of roots)
    for (const el of root.querySelectorAll("*")) {
      if (el.closest("svg, script, style, noscript, [aria-hidden=true], .sr-only, [hidden], [data-bidi-ok]")) continue;
      const nodes = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (!nodes.length || !visible(el)) continue;
      const text = el.textContent.trim().replace(/\s+/g, " ");
      if (!HE.test(firstStrong(text))) continue;
      const cs = getComputedStyle(el);
      if (cs.direction !== "rtl") out.push({ why: "Hebrew text with an LTR base", sel: where(el), text: text.slice(0, 60) });
      // Latin after a Hebrew word, same line → to its left.
      for (const t of nodes) {
        const s = t.textContent;
        if (!HE.test(firstStrong(s)) || !/[A-Za-z]/.test(s)) continue;
        for (const m of s.matchAll(/([֐-׿][֐-׿"'״׳]*)([\s ]+)([A-Za-z][A-Za-z0-9.+\-]*)/g)) {
          const he = document.createRange();
          he.setStart(t, m.index);
          he.setEnd(t, m.index + m[1].length);
          const la = document.createRange();
          const at = m.index + m[1].length + m[2].length;
          la.setStart(t, at);
          la.setEnd(t, at + m[3].length);
          const a = he.getBoundingClientRect();
          const b = la.getBoundingClientRect();
          if (!a.width || !b.width || Math.abs(a.top - b.top) > 2) continue; // wrapped onto another line
          if (b.left > a.left + 1) out.push({ why: `Latin "${m[3]}" sits right of the Hebrew before it`, sel: where(el), text: s.trim().slice(0, 60) });
        }
      }
    }
  return out;
}

const found = new Map();
let screens = 0;
const record = (at, list) => {
  screens++;
  for (const f of list) {
    const k = `${f.why} · ${f.sel}`;
    if (!found.has(k)) found.set(k, { texts: new Set(), screens: [] });
    found.get(k).texts.add(f.text);
    found.get(k).screens.push(at);
  }
};
if (want("walk")) {
  const VIEWS = ["/", "/?v=to_buy", "/?v=ordered", "/?v=history", "/?v=orders", "/?v=spending", "/?v=projects", "/?v=collection&id=pa_big_c0", "/?v=store&key=ksp", "/inbox"];
  const SETTINGS = ["account", "display", "ai", "calendar", "memory", "data", "activity", "reports", "notifications", "general", "people", "budget", "danger"];
  const ADMIN = ["/admin", "/admin/people", "/admin/people/ad_noa", "/admin/invites", "/admin/ai", "/admin/reports", "/admin/errors", "/admin/system"];
  for (const space of [app.personal, "pa_big"])
    for (const z of [{ w: 390, h: 844, phone: true }, { w: 1366, h: 768 }]) {
      const { ctx, page } = await boot({ ...z, locale: "he", space });
      const tag = `${space === app.personal ? "demo" : "big"} ${z.w}`;
      for (const v of VIEWS) {
        await page.goto(BASE + v);
        await settle(page);
        record(`${tag} ${v}`, await page.evaluate(scan));
      }
      for (const sec of SETTINGS) {
        await page.goto(`${BASE}/settings/${sec}`);
        await settle(page);
        await page.waitForTimeout(300);
        record(`${tag} /settings/${sec}`, await page.evaluate(scan, "[data-settings]"));
      }
      // Menus and sheets: the "+" (New) menu, the switcher menu, the palette (desktop) / Me sheet (phone), the item sheet.
      await page.goto(BASE + "/?v=to_buy");
      await settle(page);
      if (z.phone) {
        await page.click("[data-plus]");
        await page.waitForTimeout(450);
        record(`${tag} + sheet`, await page.evaluate(scan, "[role=dialog]"));
        await page.keyboard.press("Escape");
        await page.click("[data-me-open]").catch(() => {});
        await page.waitForTimeout(450);
        record(`${tag} me sheet`, await page.evaluate(scan, "[role=dialog]"));
        await page.keyboard.press("Escape");
      } else {
        await page.click("[data-add-menu]");
        await page.waitForTimeout(300);
        record(`${tag} + menu`, await page.evaluate(scan, "[role=menu]"));
        await page.keyboard.press("Escape");
        await page.click("[data-space-switcher]");
        await page.waitForTimeout(300);
        record(`${tag} switcher menu`, await page.evaluate(scan, "[role=menu]"));
        await page.keyboard.press("Escape");
        await page.keyboard.press("Control+k");
        await page.waitForTimeout(400);
        record(`${tag} palette`, await page.evaluate(scan, "[role=dialog]"));
        await page.keyboard.press("Escape");
      }
      const card = page.locator("main [data-item-card], main [data-item-row]").first();
      if (await card.count()) {
        await card.click();
        await page.waitForTimeout(500);
        record(`${tag} item sheet`, await page.evaluate(scan, "[role=dialog]"));
        await page.keyboard.press("Escape");
      }
      if (space === app.personal)
        for (const r of ADMIN) {
          await page.goto(BASE + r);
          await page.waitForSelector("[data-live], [data-people], [data-person], [data-invites], [data-ai], [data-reports], [data-errors], [data-system-page]", { timeout: 30_000 });
          await page.waitForTimeout(700);
          record(`${tag} ${r}`, await page.evaluate(scan, /\/people\/./.test(r) ? "[data-person]" : ".nx.adm"));
        }
      if (space === app.personal) {
        for (const r of ["/privacy", "/terms"]) {
          await page.goto(BASE + r);
          await page.waitForTimeout(500);
          record(`${tag} ${r}`, await page.evaluate(scan));
        }
        for (let step = 1; step <= 7; step++) {
          await app.db.execute({
            sql: "INSERT INTO user_pref (user_id, key, value, updated_at) VALUES (?, 'pref:onboarding', ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value",
            args: [app.admin, JSON.stringify({ v: 1, status: "active", step, why: ["home", "super"], stores: ["shufersal", "home-center", "custom:Makolet Shalom"], custom: ["Makolet Shalom"], budget: 12500, currency: "ILS", who: "family", sharedSpaceId: null, notif: null, installed: false, at: Date.now() }), Date.now()],
          });
          await page.goto(`${BASE}/welcome`);
          await page.waitForSelector("[data-ob-step]", { timeout: 30_000 });
          await page.waitForTimeout(500);
          record(`${tag} /welcome step ${step}`, await page.evaluate(scan, ".nx.ob"));
        }
        await app.db.execute({ sql: "DELETE FROM user_pref WHERE user_id = ? AND key = 'pref:onboarding'", args: [app.admin] });
      }
      await ctx.close();
    }
}
await browser.close();
app.stop();

for (const f of fails) console.log(`FAIL ${f}`);
for (const [k, g] of found) console.log(`FAIL ${k}\n     e.g. "${[...g.texts][0]}" · on ${g.screens.length} screen(s), e.g. ${g.screens.slice(0, 2).join(" | ")}`);
const n = fails.length + found.size;
console.log(n ? `FAIL bidi: ${n} problem(s)` : `OK bidi (switcher ${want("switcher") ? "checked" : "skipped"}, ${screens} Hebrew screens)`);
process.exit(n ? 1 : 0);
