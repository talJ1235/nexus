// R17 — call a server action over HTTP the way the browser does (Next-Action header + the args as JSON), from the
// production build's server-reference manifest (.next/server/server-reference-manifest.json). Only actions some client
// component imports are in the manifest. Used by test:admin-access / test:admin-privacy.
import { readFileSync } from "node:fs";

export function actionTable() {
  const m = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")).node;
  return Object.entries(m).map(([id, v]) => ({ id, file: v.filename, name: v.exportedName, page: Object.keys(v.workers)[0] }));
}

/** The page path an action is mounted on ("app/admin/[[...path]]/page" → "/admin"). */
export const pagePath = (worker) => worker.replace(/^app/, "").replace(/\/page$/, "").replace(/\/\[\[\.\.\.[^\]]+\]\]/g, "").replace(/\/\[[^\]]+\]/g, "/x") || "/";

export async function callAction(base, cookie, a, args = []) {
  const res = await fetch(`${base}${pagePath(a.page)}`, {
    method: "POST",
    headers: { "next-action": a.id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", cookie, origin: base },
    body: JSON.stringify(args),
    redirect: "manual",
  });
  const text = await res.text();
  // A thrown error comes back as an RSC error row ("E{…}" / digest) — the answer never carries the data then.
  const failed = res.status >= 400 || /^\d+:E\{/m.test(text) || /"digest":/.test(text);
  return { status: res.status, text, failed };
}
