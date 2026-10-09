// Service worker: install + share target, and a read-only offline mode for the owner (Round 6).
// - Build assets (/_next/static, hashed) are cache-first, in a cache versioned per build (?v=<build id>).
// - The owner app ("/") is network-first; when the network fails it redirects to the cached /offline shell, which
//   renders the snapshot kept in IndexedDB. The shell is cached only when the owner app asks (after an online load)
//   and deleted on logout (login page). Guests, share and invite pages, the login page and APIs: network only.
const V = new URL(self.location.href).searchParams.get("v") || "dev";
const STATIC = `nexus-static-${V}`;
const SHELL = `nexus-shell-${V}`;
const OWNER_PAGES = new Set(["/", "/offline"]);
const ASSET = /^\/(_next\/static\/|icons\/|vendor\/|favicon\.ico$|icon|apple-icon|manifest\.webmanifest$)/;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith("nexus-") && k !== STATIC && k !== SHELL) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (e) => {
  if (e.data?.type === "cache-shell") e.waitUntil(cacheShell().catch(() => {}));
});

async function cacheShell() {
  const res = await fetch("/offline", { credentials: "same-origin", cache: "no-store" });
  if (!res.ok || res.redirected) return; // not signed in as the owner
  const html = await res.clone().text();
  await (await caches.open(SHELL)).put("/offline", res);
  const st = await caches.open(STATIC);
  const assets = new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || []);
  const add = async (u) => {
    if (await st.match(u)) return;
    const r = await fetch(u);
    if (!r.ok) return;
    if (u.endsWith(".css")) for (const m of (await r.clone().text()).match(/\/_next\/static\/media\/[^"'\s)]+/g) || []) assets.add(m);
    await st.put(u, r);
  };
  for (const u of [...assets]) await add(u).catch(() => {});
  // Fonts found inside the stylesheets.
  for (const u of assets) await add(u).catch(() => {});
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (ASSET.test(url.pathname)) {
    e.respondWith(
      (async () => {
        const hit = await caches.match(req, { cacheName: STATIC });
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && url.pathname.startsWith("/_next/static/")) (await caches.open(STATIC)).put(req, res.clone()).catch(() => {});
        return res;
      })(),
    );
    return;
  }

  if (req.mode === "navigate" && OWNER_PAGES.has(url.pathname)) {
    e.respondWith(
      fetch(req).catch(async () => {
        const shell = await caches.match("/offline", { cacheName: SHELL });
        if (!shell) return Response.error();
        return url.pathname === "/offline" ? shell : Response.redirect(`/offline${url.search}`, 302);
      }),
    );
  }
});

// ---- R17 S3 J2: web push ----
// The payload is { id, title, body, url, tag, actions, lang, dir, renotify } (lib/notify/push.ts). `tag` = the group
// key, so a later message of the same group replaces the earlier one ("Noa is shopping" → "Noa finished shopping").
// Open windows are told (postMessage) so the bell's count updates without a reload.
const tell = async (msg) => {
  for (const c of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) c.postMessage(msg);
};
const samePath = (u) => (typeof u === "string" && u.startsWith("/") && !u.startsWith("//") ? u : "/");

self.addEventListener("push", (e) => {
  let p = null;
  try {
    p = e.data ? e.data.json() : null;
  } catch {
    p = null;
  }
  const title = (p && p.title) || "Nexus";
  const opts = {
    body: (p && p.body) || "",
    icon: "/icons/icon-192.png?v=3",
    badge: "/icons/badge-96.png",
    tag: (p && p.tag) || "nexus",
    renotify: !!(p && p.renotify),
    dir: p && p.dir === "rtl" ? "rtl" : "ltr",
    lang: (p && p.lang) || "en",
    data: { id: (p && p.id) || null, url: samePath(p && p.url) },
    actions: Array.isArray(p && p.actions) ? p.actions.slice(0, 2) : [],
  };
  e.waitUntil(Promise.all([self.registration.showNotification(title, opts), tell({ type: "nexus-notify", id: opts.data.id })]));
});

self.addEventListener("notificationclick", (e) => {
  const n = e.notification;
  const data = n.data || {};
  n.close();
  if (e.action === "received") {
    // Marks the item received with the session cookie (the route refuses without one); shows nothing more.
    e.waitUntil(
      fetch("/api/notify/received", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: data.id }) })
        .catch(() => null)
        .then(() => tell({ type: "nexus-notify", id: data.id, received: true })),
    );
    return;
  }
  const url = new URL(samePath(data.url), self.location.origin).href;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) {
        await win.focus().catch(() => {});
        if ("navigate" in win) return win.navigate(url).catch(() => self.clients.openWindow(url));
        return win.postMessage({ type: "nexus-open", url });
      }
      return self.clients.openWindow(url);
    })(),
  );
});

// The browser rotated this device's push address: subscribe again with the same key and save it.
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil(tell({ type: "nexus-resubscribe" }));
});
