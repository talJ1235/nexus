"use client";

import { useMemo } from "react";
import { Bookmark } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Modal } from "@/components/ui/overlays";

/** Runs on the store page: reads JSON-LD / OpenGraph in the browser and hands it to Nexus. */
function buildBookmarklet(origin: string) {
  const code = `(()=>{const q=s=>document.querySelector(s),m=n=>{const e=q('meta[property="'+n+'"],meta[name="'+n+'"],meta[itemprop="'+n+'"]');return e&&e.content},S=v=>v==null?null:typeof v=='object'?(v.name||v.url||v['@value']||null):String(v);let p={};for(const s of document.querySelectorAll('script[type="application/ld+json"]')){try{const w=o=>{if(!o||typeof o!='object')return;if(Array.isArray(o))return o.forEach(w);const t=[].concat(o['@type']||[]).join(' ').toLowerCase();if(/product/.test(t)&&!p.title){p.title=S(o.name);const f=[].concat(o.offers||[])[0]||{};p.price=f.price||f.lowPrice||(f.priceSpecification||{}).price;p.currency=f.priceCurrency||(f.priceSpecification||{}).priceCurrency;p.image=S([].concat(o.image||[])[0]);p.brand=S(o.brand);p.description=S(o.description)}[].concat(o['@graph']||[]).forEach(w)};w(JSON.parse(s.textContent))}catch(e){}}const ip=q('[itemprop=price]');p.title=p.title||m('og:title')||document.title;p.image=p.image||m('og:image');p.price=p.price||m('product:price:amount')||m('og:price:amount')||(ip&&(ip.content||ip.textContent));p.currency=p.currency||m('product:price:currency')||m('og:price:currency')||m('priceCurrency');if(!p.price){const el=q('[class*=price--current],[class*=product-price-current],[class*=uniform-banner-box-price],.a-price .a-offscreen,#priceblock_ourprice,[data-testid*=price]');if(el)p.price=el.textContent.trim()}p.siteName=m('og:site_name');p.url=location.href;for(const k in p){if(p[k]==null||p[k]==='')delete p[k];else p[k]=String(p[k]).slice(0,k=='description'?600:900)}window.open('${origin}/add?d='+encodeURIComponent(JSON.stringify(p)),'_blank')})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

export function BookmarkletDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const href = useMemo(() => (typeof window === "undefined" ? "#" : buildBookmarklet(window.location.origin)), []);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t.add.bookmarklet} description={t.add.bookmarkletHint}>
      <div className="grid place-items-center rounded-xl border border-dashed border-line-strong bg-sunken py-8">
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          draggable
          className="inline-flex cursor-grab items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg shadow-card active:cursor-grabbing"
          // React blocks javascript: URLs in href at render; set it after mount via ref.
          ref={(el) => {
            if (el) el.setAttribute("href", href);
          }}
        >
          <Bookmark className="size-4" />
          + Nexus
        </a>
      </div>
    </Modal>
  );
}
