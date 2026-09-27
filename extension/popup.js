const $ = (s) => document.querySelector(s);
const view = $("#view");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const call = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));

function money(v, c) {
  const n = parseFloat(String(v ?? "").replace(/[^\d.]/g, ""));
  if (!isFinite(n) || !n) return null;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: c || "USD", maximumFractionDigits: 2 }).format(n); } catch { return `${n} ${c || ""}`; }
}

function message(icon, title, body, actions = "") {
  view.innerHTML = `<div class="msg">${icon}<h2>${esc(title)}</h2><p>${body}</p>${actions}</div>`;
}

(async () => {
  const cfg = await call({ type: "config" });
  if (!cfg?.origin || !cfg?.token) {
    message('<div class="ok-dot" style="background:var(--accent);color:var(--accent-fg)">!</div>', "Connect to Nexus", "Open your Nexus site once in this browser (while signed in) — the extension connects automatically.");
    return;
  }
  $("#open").href = cfg.origin;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || "")) {
    message("", "Open a product page", "Go to any store's product page and click the extension again.");
    return;
  }
  const res = await call({ type: "extract-tab", tabId: tab.id });
  const d = (res && res.data) || { url: tab.url, title: tab.title };
  let collections = [];
  try {
    const r = await fetch(`${cfg.origin}/api/ext/collections`, { headers: { authorization: `Bearer ${cfg.token}` } });
    if (r.ok) collections = (await r.json()).collections || [];
  } catch {}

  const price = money(d.price, d.currency);
  view.innerHTML = `
    <div class="card">
      <div class="thumb">${d.image ? `<img src="${esc(d.image)}" alt="">` : ""}</div>
      <div style="min-width:0;flex:1">
        <textarea class="title" id="t" rows="3">${esc(d.title || "")}</textarea>
        <div class="meta">${esc(new URL(d.url).hostname.replace(/^www\./, ""))}</div>
        <span class="tag ${price ? "" : "muted"}">${price ? esc(price) : "No price found"}</span>
      </div>
    </div>
    <label for="c">Project or list</label>
    <div class="row">
      <select id="c"><option value="">Auto (let Nexus decide)</option>${collections.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select>
      <input id="q" type="number" min="1" value="1" title="Quantity" />
    </div>
    <button class="primary" id="save">Save to Nexus</button>
    <div id="err" class="err"></div>`;

  const save = async (mode) => {
    $("#save").disabled = true;
    $("#save").textContent = "Saving…";
    const body = { payload: { ...d, title: $("#t").value.trim() || d.title }, collectionId: $("#c").value || null, quantity: Math.max(1, parseInt($("#q").value) || 1), mode };
    const out = await call({ type: "save", body });
    if (!out?.ok) {
      $("#save").disabled = false;
      $("#save").textContent = "Save to Nexus";
      $("#err").textContent = out?.error === "unauthorized" ? "Nexus sign-in changed — open Nexus once to reconnect." : "Couldn't save. Try again.";
      return;
    }
    if (out.status === "duplicate") {
      const sameUrl = out.duplicate.reason === "url";
      message('<div class="ok-dot" style="background:var(--accent);color:var(--accent-fg)">≈</div>', sameUrl ? "Already saved" : "Looks like you have this", esc(out.duplicate.title),
        sameUrl ? `<button class="secondary" id="open-it">Open in Nexus</button>` :
        `<button class="primary" id="as-source">Add as another store for it</button><button class="secondary" id="separate">Keep as separate item</button>`);
      $("#open-it")?.addEventListener("click", () => chrome.tabs.create({ url: `${cfg.origin}/?item=${out.duplicate.itemId}` }));
      $("#as-source")?.addEventListener("click", () => { view.innerHTML = '<div class="loading"><div class="sk img"></div><div class="sk l1"></div><div class="sk l2"></div></div>'; saveAgain("source"); });
      $("#separate")?.addEventListener("click", () => { view.innerHTML = '<div class="loading"><div class="sk img"></div><div class="sk l1"></div><div class="sk l2"></div></div>'; saveAgain("separate"); });
      return;
    }
    message('<div class="ok-dot">✓</div>', "Saved to Nexus", esc(out.item.title), `<button class="secondary" id="view-it">Open in Nexus</button>`);
    $("#view-it").addEventListener("click", () => chrome.tabs.create({ url: `${cfg.origin}/?item=${out.item.id}` }));
  };
  const saveAgain = async (mode) => {
    const body = { payload: { ...d }, collectionId: null, quantity: 1, mode };
    const out = await call({ type: "save", body });
    if (out?.ok && out.item) message('<div class="ok-dot">✓</div>', "Saved to Nexus", esc(out.item.title));
    else message("", "Couldn't save", "Try again from the page.");
  };
  $("#save").addEventListener("click", () => save("auto"));
})();
