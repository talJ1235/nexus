// Renders an approved design board (docs/design/<round>/*.dc.html) to static HTML in the page: evaluates the board's
// logic class with the given props, then expands <sc-for>/<sc-if>/{{expr}} recursively against the DOM (nested loops,
// attributes, expressions). Used by the parity scripts.
import { readFileSync } from "node:fs";

export function boardHtml(dir, name) {
  const src = readFileSync(`${dir}/${name}.dc.html`, "utf8");
  const script = src.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
  let tpl = src.match(/<x-dc>([\s\S]*?)<\/x-dc>/)[1];
  const helmet = (tpl.match(/<helmet>([\s\S]*?)<\/helmet>/) ?? [, ""])[1];
  tpl = tpl.replace(/<helmet>[\s\S]*?<\/helmet>/, "");
  const css = ["nx.css", "nx16.css", "nx17.css", "nx18.css"].map((f) => { try { return readFileSync(`${dir}/${f}`, "utf8"); } catch { return ""; } }).join("\n");
  const rtl = /<html[^>]*dir="rtl"/.test(src);
  return { script, tpl, helmet, css, rtl };
}

/** Runs in the browser: expands the template into document.body. */
export function expandInPage({ script, tpl, props }) {
  class DCLogic { constructor(p) { this.props = p; this.state = null; } setState(s) { this.state = { ...(this.state || {}), ...s }; } }
  const Component = new Function("DCLogic", `${script}; return Component;`)(DCLogic);
  const vals = new Component(props).renderVals();
  const evalIn = (expr, scope) => { try { return new Function("__s", `with(__s){ return (${expr}); }`)(scope); } catch { return undefined; } };
  const sub = (str, scope) => {
    const whole = str.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
    if (whole) return evalIn(whole[1], scope);
    return str.replace(/\{\{([\s\S]+?)\}\}/g, (_, e) => { const v = evalIn(e, scope); return v == null || typeof v === "function" ? "" : String(v); });
  };
  const host = document.createElement("template");
  host.innerHTML = tpl;
  const walk = (node, scope) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) { if (child.nodeValue.includes("{{")) child.nodeValue = sub(child.nodeValue, scope) ?? ""; continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === "sc-for") {
        const list = sub(child.getAttribute("list"), scope) || [];
        const as = child.getAttribute("as") || "item";
        const frag = document.createDocumentFragment();
        list.forEach((it, i) => { const c = child.cloneNode(true); walk(c, { ...scope, [as]: it, index: i }); while (c.firstChild) frag.appendChild(c.firstChild); });
        child.replaceWith(frag);
        continue;
      }
      if (tag === "sc-if") {
        const v = sub(child.getAttribute("value"), scope);
        if (!v) { child.remove(); continue; }
        walk(child, scope);
        const frag = document.createDocumentFragment();
        while (child.firstChild) frag.appendChild(child.firstChild);
        child.replaceWith(frag);
        continue;
      }
      for (const a of [...child.attributes]) {
        if (!a.value.includes("{{")) continue;
        if (/^on[A-Z]/.test(a.name) || /^on/i.test(a.name)) { child.removeAttribute(a.name); continue; }
        const v = sub(a.value, scope);
        if (v === false || v == null) child.removeAttribute(a.name); else child.setAttribute(a.name, v === true ? "" : String(v));
      }
      walk(child.content ?? child, scope);
    }
  };
  walk(host.content, vals);
  document.body.appendChild(host.content);
}

export async function renderBoard(page, dir, name, props) {
  const b = boardHtml(dir, name);
  await page.setContent(`<!doctype html><html${b.rtl ? ' dir="rtl"' : ""}><head><meta charset="utf-8"><style>${b.css}</style>${b.helmet}</head><body style="margin:0"></body></html>`, { waitUntil: "load" });
  await page.evaluate(expandInPage, { script: b.script, tpl: b.tpl, props });
  await page.waitForTimeout(500);
}
