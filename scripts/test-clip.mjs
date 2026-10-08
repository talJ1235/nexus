// R17 A6 guard — no cut-off text anywhere. Walks the main views, every Settings section and the main sheets/menus on
// phone 360 / 390 and desktop 1366 / 1280×720, English + Hebrew, light + dark, on the demo data and the 500-item worst
// case space (scripts/lib/test-app.mjs: fresh DB, seeded session). Per text element (the actual glyph boxes, via a DOM
// Range — invisible tap-area pseudo-elements don't count) it fails when the text is cut by a box that hides overflow:
//   • clipped without an intended truncation (`text-overflow: ellipsis` or `-webkit-line-clamp`), or
//   • truncated with no way to read the whole text (a `title`, an aria-label with it, or a tap target around it that
//     opens the thing — a link / button / [data-expandable]), or
//   • a number or an amount that is truncated at all (polish #23: numbers never truncate), or
//   • text running off the side of the screen.
// Scroll containers (overflow: auto/scroll) aren't cuts. Report = screen · viewport · locale · selector · text.
// Usage: npm run build, then `npm run test:clip` (PORT=3109). CLIP_ONLY=settings,views,sheets  CLIP_QUICK=1 (390 + 1366,
// one theme, English + Hebrew).
import { chromium } from "playwright";
import { startApp } from "./lib/test-app.mjs";

const PORT = Number(process.env.PORT || 3109);
const QUICK = !!process.env.CLIP_QUICK;
const ONLY = (process.env.CLIP_ONLY || "").split(",").filter(Boolean);
const want = (g) => !ONLY.length || ONLY.includes(g);
const app = await startApp({ db: "clip-test.db", port: PORT });
const BASE = app.base;

const VIEWS = ["/", "/?v=to_buy", "/?v=ordered", "/?v=history", "/?v=orders", "/?v=spending", "/?v=projects", "/?v=collection&id=pa_big_c0", "/?v=store&key=ksp"];
const YOU = ["account", "display", "ai", "calendar", "memory", "data", "activity", "reports", "invites"];
const SPACE = ["general", "people", "budget", "danger"];
const SIZES = QUICK
  ? [{ w: 390, h: 844, phone: true }, { w: 1366, h: 768 }]
  : [{ w: 360, h: 740, phone: true }, { w: 390, h: 844, phone: true }, { w: 1366, h: 768 }, { w: 1280, h: 720 }];
const LOCALES = ["en", "he"];
const SCHEMES = QUICK ? ["light"] : ["light", "dark"];

/** In the page: every cut text element under `root` (default: the document). */
function scan(rootSel) {
  const out = [];
  const root = rootSel ? document.querySelector(rootSel) : document.body;
  if (!root) return out;
  const vw = document.documentElement.clientWidth;
  const NUM = /^[\s+−\-–]*[₪$€£¥]?\s?[\d.,\s]+[%KMBkmb]?\s?[₪$€£¥]?$/;
  // Where: the nearest two ancestors that carry a data-* name (a widget, a section, a sheet), then the tag chain.
  const marks = (e) => {
    const m = [];
    for (let n = e.parentElement; n && m.length < 2; n = n.parentElement) {
      const d = [...n.attributes].find((a) => a.name.startsWith("data-") && !["data-state", "data-side", "data-align", "data-orientation"].includes(a.name));
      if (d) m.unshift(d.name.slice(5) + (d.value && d.value.length < 24 && !/\d/.test(d.value) && d.value !== "true" && d.value !== "" ? `=${d.value}` : ""));
    }
    return m.join(" › ");
  };
  const path = (e) => {
    const parts = [];
    for (let n = e; n && n !== document.body && parts.length < 4; n = n.parentElement) {
      const d = [...n.attributes].find((a) => a.name.startsWith("data-") && a.name !== "data-state");
      parts.unshift(n.tagName.toLowerCase() + (d ? `[${d.name}${d.value && d.value.length < 24 && !/d/.test(d.value) ? `=${d.value}` : ""}]` : ""));
    }
    return parts.join(" > ");
  };
  const coarse = matchMedia("(pointer: coarse)").matches;
  const readable = (e, text) => {
    // Fine pointer: hovering it must reveal the whole text (lib/trunc-title.ts sets the title on hover) — try it.
    if (!coarse) {
      e.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      for (let n = e, k = 0; n && k < 3; n = n.parentElement, k++) if (n.title && n.title.replace(/\s+/g, " ").trim().startsWith(text.slice(0, 20))) return true;
      return false;
    }
    // Touch: inside a row / card that opens the full item, or a control.
    if (e.closest("[data-item-card], [data-item-row], [data-opens]")) return true;
    for (let n = e, k = 0; n && k < 6; n = n.parentElement, k++) {
      if (n.title && n.title.trim()) return true;
      const al = n.getAttribute("aria-label");
      if (al && al.includes(text.slice(0, 12))) return true;
      if (n.matches("a[href], button, [role=button], [role=link], [role=tab], [data-expandable], summary, label")) return true;
      // A card / row that opens on tap (its handler is React's, so the pointer cursor is the visible sign of it).
      if (getComputedStyle(n).cursor === "pointer") return true;
    }
    return false;
  };
  for (const el of root.querySelectorAll("*")) {
    if (el.closest("svg, script, style, noscript, [data-clip-ok], [aria-hidden=true], .sr-only, input, textarea, select, option, [hidden]")) continue;
    // A text container: holds text itself, and no block-level children (those are checked on their own).
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "inline" || cs.display === "contents" || cs.visibility === "hidden" || +cs.opacity === 0) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    // Its own glyphs: its text nodes and inline children (block-level children are text containers of their own).
    const rects = [];
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) {
          if (!c.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(c);
          rects.push(...[...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5));
        } else if (c.nodeType === 1 && !c.matches("svg, [aria-hidden=true], .sr-only") && getComputedStyle(c).display.startsWith("inline") && getComputedStyle(c).display !== "inline-block" && getComputedStyle(c).display !== "inline-flex") walk(c);
      }
    };
    walk(el);
    if (!rects.length) continue;
    const tx = { l: Math.min(...rects.map((r) => r.left)), r: Math.max(...rects.map((r) => r.right)), t: Math.min(...rects.map((r) => r.top)), b: Math.max(...rects.map((r) => r.bottom)) };
    // What's visible: the element's own box if it hides overflow, then every hiding ancestor (scrollers don't cut).
    const vis = { l: -1e9, r: 1e9, t: -1e9, b: 1e9 };
    let ellipsis = false;
    let clamp = false;
    let cutBy = null;
    let scrolled = false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const s = n === el ? cs : getComputedStyle(n);
      // Partly scrolled out of a scroll container (a list, a sheet) is reachable, not cut.
      if (n !== el && /auto|scroll/.test(s.overflowY + s.overflowX)) {
        const r = n.getBoundingClientRect();
        if (tx.b > r.bottom + 1 || tx.t < r.top - 1 || tx.r > r.right + 1 || tx.l < r.left - 1) scrolled = true;
      }
      if (s.textOverflow === "ellipsis") ellipsis = true;
      if (s.webkitLineClamp && s.webkitLineClamp !== "none") clamp = true;
      const hx = s.overflowX === "hidden" || s.overflowX === "clip";
      const hy = s.overflowY === "hidden" || s.overflowY === "clip";
      if (!hx && !hy) continue;
      const r = n.getBoundingClientRect();
      if (hx && (r.left > vis.l || r.right < vis.r)) (vis.l = Math.max(vis.l, r.left)), (vis.r = Math.min(vis.r, r.right)), (cutBy ??= n);
      if (hy && (r.top > vis.t || r.bottom < vis.b)) (vis.t = Math.max(vis.t, r.top)), (vis.b = Math.min(vis.b, r.bottom));
    }
    if (scrolled) continue;
    // Box fully hidden by an ancestor (a folded section, a pager's off-screen slide): not on screen, not a cut.
    if (box.right <= vis.l || box.left >= vis.r || box.bottom <= vis.t || box.top >= vis.b) continue;
    const text = el.textContent.trim().replace(/\s+/g, " ");
    const cutX = tx.r > vis.r + 1.5 || tx.l < vis.l - 1.5;
    // Vertically, a cut is a whole line out of view (glyph boxes poke past a tight line-height without being cut).
    const cutY = rects.some((r) => r.top >= vis.b - 1 || r.bottom <= vis.t + 1);
    const offScreen = tx.r > vw + 1.5 || tx.l < -1.5;
    if (!cutX && !cutY && !offScreen) continue;
    const intended = ellipsis || clamp;
    const why = offScreen && !cutX
      ? "runs off the screen"
      : NUM.test(text)
        ? "number truncated"
        : !intended
          ? `cut (${cutX ? "sideways" : "bottom"}, no ellipsis)`
          : !readable(el, text)
            ? "truncated with no way to read it all"
            : null;
    if (why) out.push({ why, sel: `${marks(el)} :: ${path(el)}`, text: text.slice(0, 60) });
  }
  return out;
}

const browser = await chromium.launch();
const found = new Map(); // why · where → { texts, screens }
let screens = 0;
const record = (where, list) => {
  screens++;
  for (const f of list) {
    const k = `${f.why} · ${f.sel}`;
    if (!found.has(k)) found.set(k, { texts: new Set(), screens: [] });
    const g = found.get(k);
    g.texts.add(f.text);
    g.screens.push(where);
  }
};

for (const space of [app.personal, "pa_big"])
  for (const z of SIZES)
    for (const locale of LOCALES)
      for (const scheme of SCHEMES) {
        const ctx = await browser.newContext({ viewport: { width: z.w, height: z.h }, colorScheme: scheme, reducedMotion: "reduce", ...(z.phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
        ctx.setDefaultTimeout(30_000);
        await ctx.addCookies(app.cookies(space, locale));
        await ctx.addInitScript(() => {
          try {
            sessionStorage.setItem("nexus.opened", "1");
            const d = new Date();
            localStorage.setItem("nexus.bootDay", `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
          } catch {}
        });
        const page = await ctx.newPage();
        const tag = `${space === app.personal ? "demo" : "big"} ${z.w}×${z.h} ${locale} ${scheme}`;
        const settle = async () => {
          await page.waitForSelector("[data-app-shell][data-ready]", { timeout: 30_000 });
          await page.waitForTimeout(350);
        };
        if (want("views"))
          for (const v of VIEWS) {
            await page.goto(BASE + v);
            await settle();
            record(`${tag} ${v}`, await page.evaluate(scan));
          }
        if (want("settings")) {
          const sections = [...YOU, ...(space === "pa_big" ? SPACE : ["general", "budget"])];
          for (const sec of z.phone ? ["", ...sections] : sections) {
            await page.goto(`${BASE}/settings${sec ? `/${sec}` : ""}`);
            await settle();
            await page.waitForTimeout(400);
            record(`${tag} /settings/${sec}`, await page.evaluate(scan, "[data-settings]"));
          }
        }
        if (want("sheets")) {
          // The item sheet, the command palette (desktop) / Me sheet + "+" menu (phone).
          await page.goto(`${BASE}/?v=to_buy`);
          await settle();
          const card = page.locator("main [data-item-card], main [data-item-row]").first();
          if (await card.count()) {
            await card.click();
            await page.waitForTimeout(500);
            record(`${tag} item sheet`, await page.evaluate(scan, "[role=dialog]"));
            await page.keyboard.press("Escape");
            await page.waitForTimeout(300);
          }
          if (z.phone) {
            await page.locator("[data-me-open]").click().catch(() => {});
            await page.waitForTimeout(450);
            record(`${tag} me sheet`, await page.evaluate(scan, "[role=dialog]"));
            await page.keyboard.press("Escape");
          } else {
            await page.keyboard.press("Control+k");
            await page.waitForTimeout(400);
            record(`${tag} palette`, await page.evaluate(scan, "[role=dialog]"));
            await page.keyboard.press("Escape");
          }
        }
        await ctx.close();
      }
await browser.close();
app.stop();

const fails = [...found.entries()];
for (const [k, g] of fails) console.log(`FAIL ${k}\n     ${g.texts.size} text(s), e.g. "${[...g.texts][0]}" · on ${g.screens.length} screen(s), e.g. ${g.screens.slice(0, 2).join(" | ")}`);
console.log(fails.length ? `FAIL ${fails.length} place(s) with cut text on ${screens} screens` : `OK clip (${screens} screens, no cut text)`);
process.exit(fails.length ? 1 : 0);
