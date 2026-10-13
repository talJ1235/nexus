"use client";

import "./sm.css";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/components/providers";
import { DEFAULT_ORDER, sectionName } from "@/lib/grocery/sections";
import type { ItemWithSources } from "@/lib/types";
import { useStore } from "../store";
import { ProductTile, SectionIcon, sectionColor } from "./art";
import { qtyLabel } from "./qty";

// R18 S2 — the Supermarket tab (board Supermarket-phone `Main`): the list by sections in walking order.

/** The list grouped by section in `order` (unknown / `other` last). */
export function bySection(items: ItemWithSources[], order: readonly string[] = DEFAULT_ORDER) {
  const m = new Map<string, ItemWithSources[]>();
  for (const i of items) {
    const k = i.section && order.includes(i.section) ? i.section : "other";
    m.set(k, [...(m.get(k) ?? []), i]);
  }
  return [...order, "other"].filter((k) => m.has(k)).map((k) => [k, m.get(k)!] as const);
}

export function SupermarketView() {
  const s = useStore();
  const { t } = useI18n();
  const groups = useMemo(() => bySection(s.sm), [s.sm]);
  return (
    <div className="flex flex-col gap-3 pb-6" data-sm-view>
      <h1 className="text-[26px] font-extrabold tracking-[-0.02em]">{t.sm.title}</h1>
      <div className="flex flex-col gap-1.5">
        {groups.map(([k, list]) => (
          <Section key={k} section={k} items={list} />
        ))}
      </div>
    </div>
  );
}

function Section({ section, items }: { section: string; items: ItemWithSources[] }) {
  const { locale } = useI18n();
  const [shut, setShut] = useState(false);
  return (
    <section className="gro-sec" style={{ "--k": sectionColor(section) } as React.CSSProperties} data-shut={shut ? "" : undefined} data-sm-section={section}>
      <button type="button" className="gro-sec-h" onClick={() => setShut(!shut)} aria-expanded={!shut}>
        <SectionIcon section={section} />
        <span className="gro-nm">{sectionName(section, locale)}</span>
        <span className="gro-n">{items.length}</span>
        <ChevronDown className="gro-cv size-4" />
      </button>
      <div className="gro-sec-b">
        <div>
          <div className="gro-box">
            {items.map((i) => (
              <Row key={i.id} item={i} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ item }: { item: ItemWithSources }) {
  const { locale } = useI18n();
  return (
    <div className="gro-row" data-sm-row={item.id}>
      <ProductTile art={item.artKey} section={item.section} />
      <span className="min-w-0 flex-1">
        <span className="gro-t bidi">{item.title}</span>
        {item.notes && <span className="gro-s bidi truncate">{item.notes}</span>}
      </span>
      <span className="gro-q">{qtyLabel(item, locale)}</span>
    </div>
  );
}
