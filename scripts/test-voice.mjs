// R18 S4 C1 — voice add (record + AI), on the built app with a throwaway DB and mock AI:
//   the route: Hebrew + English recordings (mock: "mockvoice:<words>") → the products as lines; nothing heard → empty;
//   a wrong type / an empty body refused; the daily AI limit → limit (one call per recording, feature `grocery`).
//   the screen: a fake MediaRecorder + mic — the level meter and the clock while recording, Tap to finish →
//   "Understanding…" → the items as chips over the review → added (merged into a row already on the list); the first
//   use shows the example line; a blocked mic says how to allow it.
//   npm run build && npm run test:voice
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startApp } from "./lib/test-app.mjs";
import { PHONE_UA } from "./lib/phone.mjs";

const app = await startApp({ db: "voice-test.db", port: Number(process.env.PORT || 3133) });
const browser = await chromium.launch();
let failed = false;
try {
  // ---- unit: the model's items → review lines; the recorder's format pick
  const { itemLines, pickMime } = await import("../src/lib/grocery/recorder.ts");
  assert.deepEqual(itemLines([{ name: "חלב", qty: 2 }, { name: "לחם", qty: 1 }, { name: "עגבניות", qty: 1, amount: 0.5, unit: "kg" }, { name: "  " }, { name: "juice", amount: 1, unit: "L" }]), ["2 חלב", "לחם", "0.5 kg עגבניות", "1 l juice"]);
  assert.equal(pickMime((m) => m.startsWith("audio/mp4")), "audio/mp4;codecs=mp4a.40.2", "Safari: mp4");
  assert.equal(pickMime((m) => m === "audio/webm;codecs=opus"), "audio/webm;codecs=opus", "Chrome: opus in webm");
  assert.equal(pickMime(() => false), "");
  console.log("ok voice lines + recorder format");

  // ---- the route
  const cookie = app.cookies(app.personal, "en").map((c) => `${c.name}=${c.value}`).join("; ");
  const post = (body, type = "audio/wav", locale = "en") => fetch(`${app.base}/api/grocery/voice?locale=${locale}`, { method: "POST", headers: { cookie, "content-type": type, origin: app.base }, body }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
  const he = await post("mockvoice:שני חלב לחם וחצי קילו עגבניות", "audio/webm", "he");
  assert.equal(he.state, "read");
  assert.deepEqual(he.lines.length, 3, `he: three products (${JSON.stringify(he.lines)})`);
  const en = await post("mockvoice:two milk, bread and half a kilo of tomatoes");
  assert.equal(en.state, "read");
  assert.equal(en.lines.length, 3, `en: three products (${JSON.stringify(en.lines)})`);
  assert.equal((await post("silence")).state, "empty", "nothing heard → empty");
  assert.equal((await post("mockvoice:milk", "text/plain")).status, 415, "only audio");
  assert.equal((await post("", "audio/wav")).status, 413, "an empty body is refused");
  const unauth = await fetch(`${app.base}/api/grocery/voice`, { method: "POST", headers: { "content-type": "audio/wav" }, body: "mockvoice:milk" });
  assert.ok([401, 403].includes(unauth.status), "signed out → refused");
  const used = (await app.db.execute("SELECT COUNT(*) AS n FROM ai_usage WHERE feature = 'grocery'")).rows[0].n;
  assert.equal(Number(used), 3, "one AI call per recording, feature grocery");
  console.log("ok voice route: he + en → lines, nothing heard → empty, audio only, signed in only, one AI call each");

  // ---- the screen (phone): fake recorder + mic
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: PHONE_UA });
  await ctx.addCookies(app.cookies(app.personal, "en"));
  await ctx.addInitScript(() => {
    // A mic whose level wobbles (an oscillator), and a recorder whose "audio" is what the mock AI reads.
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (window.__micBlocked) throw new DOMException("denied", "NotAllowedError");
      if (!c?.audio) throw new DOMException("no", "NotFoundError");
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      gain.gain.value = 0.6;
      osc.connect(gain);
      const dest = ac.createMediaStreamDestination();
      gain.connect(dest);
      osc.start();
      return dest.stream;
    };
    window.MediaRecorder = class {
      static isTypeSupported(m) {
        return m.startsWith("audio/webm");
      }
      constructor(stream, o) {
        this.stream = stream;
        this.mimeType = o?.mimeType ?? "audio/webm";
        this.state = "inactive";
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob([window.__said ?? "mockvoice:2 milk, bread"], { type: "audio/webm" }) });
        setTimeout(() => this.onstop?.(new Event("stop")), 10);
      }
    };
  });
  const page = await ctx.newPage();
  await page.goto(`${app.base}/supermarket`);
  await page.waitForSelector("[data-sm-view]", { timeout: 30_000 });
  // A row already on the list: the voice add merges into it (A1).
  await page.evaluate(() => (window.__said = "mockvoice:2 milk, bread"));
  await page.locator("[data-sm-add-voice]").first().click();
  await page.waitForSelector('[data-add-voice="listening"]', { timeout: 10_000 });
  const example = await page.locator("[data-add-voice-example]").count();
  await page.waitForTimeout(1300);
  const meter = await page.locator("[data-add-voice-meter] i").evaluateAll((els) => els.map((e) => e.style.transform));
  const clock = await page.locator("[data-add-voice-time]").textContent();
  await page.locator("[data-add-voice-stop]").click();
  await page.waitForSelector("[data-add-voice-chips]", { timeout: 10_000 });
  const chips = await page.locator("[data-add-voice-chips] > span").allTextContents();
  assert.equal(example, 1, "first use: the example line");
  assert.ok(meter.some((t) => t && t !== "scaleY(0.15)"), `the meter moves with the mic (${meter.join(" ")})`);
  assert.match(clock ?? "", /^0:0[1-9]$/, "the clock runs");
  assert.deepEqual(chips.map((c) => c.trim()), ["2 · milk", "bread"], "the items as chips");
  await page.locator("[data-add-parts]").click();
  await page.waitForSelector("[data-add-voice-chips]", { state: "detached", timeout: 10_000 });
  await page.locator("[data-add-back]").click();
  await page.waitForFunction(() => [...document.querySelectorAll("[data-sm-row] .gro-t")].some((e) => /^bread$/i.test(e.textContent ?? "")), null, { timeout: 10_000 });
  console.log("ok voice screen: meter + clock while recording, Tap to finish → chips over the review → added; example on first use");

  // A blocked mic: the reason and how to allow it, and Try again.
  await page.evaluate(() => (window.__micBlocked = true));
  await page.locator("[data-sm-add-voice]").first().click();
  await page.waitForSelector('[data-add-voice-error="blocked"]', { timeout: 10_000 });
  const why = await page.locator("[data-add-voice-msg]").textContent();
  assert.match(why ?? "", /blocked/i);
  assert.equal(await page.locator("[data-add-voice-example]").count(), 0, "the example only on the first use");
  console.log("ok voice: a blocked mic says how to allow it");

  // The daily limit, said in words.
  await app.db.execute({ sql: `UPDATE "user" SET role = 'user' WHERE id = ?`, args: [app.admin] });
  await app.db.execute({ sql: "INSERT INTO user_pref (user_id, key, value, updated_at) VALUES (?, 'ai:quota', '0', ?) ON CONFLICT (user_id, key) DO UPDATE SET value = '0'", args: [app.admin, Date.now()] });
  assert.equal((await post("mockvoice:milk")).state, "limit", "the route at the limit");
  await page.evaluate(() => (window.__micBlocked = false));
  await page.locator("[data-add-voice-stop]").click();
  await page.waitForSelector('[data-add-voice="listening"]', { timeout: 10_000 });
  await page.locator("[data-add-voice-stop]").click();
  await page.waitForSelector('[data-add-voice-error="limit"]', { timeout: 10_000 });
  console.log("ok voice: the daily AI limit → said, typing / scanning offered");
} catch (e) {
  failed = true;
  console.error("FAIL", e);
} finally {
  await browser.close();
  await app.stop();
}
console.log(failed ? "FAIL voice" : "OK voice");
process.exit(failed ? 1 : 0);
