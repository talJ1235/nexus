// R17 S1 — opens /admin and every tab in a signed-in admin page and collects what must never happen there: console
// errors, React hydration warnings, page errors, 5xx responses, a blank page. Used by the prod smoke, test:admin-access
// and scripts/probe-admin.mjs. Returns { tabs, problems: string[] }.
const TABS = ["/admin", "/admin/live", "/admin/people", "/admin/invites", "/admin/ai", "/admin/reports", "/admin/errors", "/admin/system", "/admin/more"];
const HYDRATION = /hydrat|#418|#419|#423|#425|did not match|server rendered/i;

export async function walkAdmin(page, base, { locale = "en", tabs = TABS, settle = 2500 } = {}) {
  const problems = [];
  let where = "";
  const onConsole = (m) => {
    if (m.type() === "error" || (m.type() === "warning" && HYDRATION.test(m.text()))) problems.push(`${where}: console ${m.type()}: ${m.text().slice(0, 300)}`);
  };
  const onPageError = (e) => problems.push(`${where}: page error: ${String(e.message || e).slice(0, 300)}`);
  const onResponse = async (r) => {
    if (r.status() < 500) return;
    let body = "";
    try {
      body = (await r.text()).slice(0, 200).replace(/\s+/g, " ");
    } catch {}
    problems.push(`${where}: ${r.status()} ${r.request().method()} ${r.url().replace(base, "")} ${body}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  await page.context().addCookies([{ name: "nexus_locale", value: locale, url: base }]);
  try {
    for (const t of tabs) {
      where = t;
      await page.goto(`${base}${t}`, { waitUntil: "load" });
      await page.waitForTimeout(settle);
      const text = (await page.evaluate(() => document.body?.innerText ?? "")).trim();
      const panel = await page.locator("main, [data-admin], nav").count();
      if (text.length < 20 || !panel) problems.push(`${t}: blank page (text ${text.length}, landmarks ${panel})`);
    }
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
  }
  return { tabs: tabs.length, problems };
}
