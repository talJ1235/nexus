"use client";

import { useMemo } from "react";
import { Bookmark, Download } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Modal } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";
import { useExtension } from "./use-extension";

/** Runs on the store page: reads JSON-LD / OpenGraph in the browser and hands it to Nexus. */
function buildBookmarklet(origin: string) {
  const code = `(()=>{const q=s=>document.querySelector(s),m=n=>{const e=q('meta[property="'+n+'"],meta[name="'+n+'"],meta[itemprop="'+n+'"]');return e&&e.content},S=v=>v==null?null:typeof v=='object'?(v.name||v.url||v['@value']||null):String(v);let p={};for(const s of document.querySelectorAll('script[type="application/ld+json"]')){try{const w=o=>{if(!o||typeof o!='object')return;if(Array.isArray(o))return o.forEach(w);const t=[].concat(o['@type']||[]).join(' ').toLowerCase();if(/product/.test(t)&&!p.title){p.title=S(o.name);const f=[].concat(o.offers||[])[0]||{};p.price=f.price||f.lowPrice||(f.priceSpecification||{}).price;p.currency=f.priceCurrency||(f.priceSpecification||{}).priceCurrency;p.image=S([].concat(o.image||[])[0]);p.brand=S(o.brand);p.description=S(o.description)}[].concat(o['@graph']||[]).forEach(w)};w(JSON.parse(s.textContent))}catch(e){}}const ip=q('[itemprop=price]');p.title=p.title||m('og:title')||document.title;p.image=p.image||m('og:image');p.price=p.price||m('product:price:amount')||m('og:price:amount')||(ip&&(ip.content||ip.textContent));p.currency=p.currency||m('product:price:currency')||m('og:price:currency')||m('priceCurrency');if(!p.price){const el=q('[class*=price--current],[class*=product-price-current],[class*=uniform-banner-box-price],.a-price .a-offscreen,#priceblock_ourprice,[data-testid*=price]');if(el)p.price=el.textContent.trim()}p.siteName=m('og:site_name');p.url=location.href;for(const k in p){if(p[k]==null||p[k]==='')delete p[k];else p[k]=String(p[k]).slice(0,k=='description'?600:900)}window.open('${origin}/add?d='+encodeURIComponent(JSON.stringify(p)),'_blank')})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

export function BookmarkletDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const ext = useExtension();
  const href = useMemo(() => (typeof window === "undefined" ? "#" : buildBookmarklet(window.location.origin)), []);
  const steps = [t.ext.step1, t.ext.step2, t.ext.step3, t.ext.step4];
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t.ext.title} description={t.ext.intro} className="max-w-lg">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg/50 p-3">
        <span className={cn("inline-flex items-center gap-2 text-sm font-medium", ext.available ? "text-ok" : "text-muted")}>
          <span className={cn("size-2 rounded-full", ext.available ? "bg-ok" : "bg-faint")} />
          {ext.available ? `${t.ext.connected} · v${ext.version}` : t.ext.notInstalled}
        </span>
        <a href="/nexus-extension.zip" download className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-strong">
          <Download className="size-4" />
          {t.ext.download}
        </a>
      </div>
      <ol className="mt-4 space-y-2.5">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-sunken text-xs font-semibold text-muted">{i + 1}</span>
            <span className="pt-0.5 leading-relaxed">
              {step}
              {i === 1 && (
                <button type="button" onClick={() => navigator.clipboard.writeText("chrome://extensions")} className="ms-2 text-xs font-medium text-accent-ink hover:underline">
                  {t.ext.copyAddress}
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-xs text-muted">{t.ext.fallback}</p>
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          draggable
          ref={(el) => {
            // React blocks javascript: URLs at render; set it after mount.
            if (el) el.setAttribute("href", href);
          }}
          className="mt-2 inline-flex cursor-grab items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium active:cursor-grabbing"
        >
          <Bookmark className="size-4 text-accent-ink" />+ Nexus
        </a>
      </div>
    </Modal>
  );
}
