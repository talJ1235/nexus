import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ExternalLink, Package } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { activeSource, lineTotal, sumTotals, unitPrice } from "@/lib/calc";
import { getSharedCollection } from "@/lib/data";
import { dictionaries, fmt, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { formatMoney, type Currency } from "@/lib/money";
import { getCurrencyPref } from "@/lib/server-prefs";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(raw) ? raw : "en";
  const t = dictionaries[locale];
  const shared = await getSharedCollection(token);

  if (!shared) {
    return (
      <main className="grid min-h-dvh place-items-center px-4 text-center">
        <div>
          <LogoMark className="mx-auto size-10" />
          <p className="mt-4 text-muted">{t.shared.notFound}</p>
        </div>
      </main>
    );
  }

  const { collection, items, rates } = shared;
  const currency: Currency = (collection.budgetCurrency as Currency) ?? (await getCurrencyPref());
  const toBuy = items.filter((i) => i.status === "to_buy");
  const total = sumTotals(toBuy, rates, currency).total;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <div className="flex items-center justify-between text-sm text-muted">
        <span className="inline-flex items-center gap-2">
          <LogoMark className="size-6" /> Nexus
        </span>
        <span>{t.shared.readOnly}</span>
      </div>
      <h1 className="mt-8 text-3xl font-semibold tracking-[-0.02em]" dir="auto">
        {collection.name}
      </h1>
      {collection.description && (
        <p className="mt-2 max-w-[65ch] text-muted" dir="auto">
          {collection.description}
        </p>
      )}
      <p className="tabular mt-2 text-sm text-muted">
        {fmt(t.collection.itemsCount, { n: items.length })}
        {total > 0 && (
          <>
            <span className="mx-2 text-faint">/</span>
            {t.view.itemsTotal} <b className="text-fg">{formatMoney(total, currency, locale)}</b>
          </>
        )}
      </p>

      <ul className="mt-6 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {items.map((i) => {
          const src = activeSource(i, rates);
          const unit = unitPrice(i, rates, currency);
          const line = lineTotal(i, rates, currency);
          return (
            <li key={i.id} className={`flex items-center gap-4 p-3 sm:p-4 ${i.status === "purchased" ? "opacity-60" : ""}`}>
              <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-tile">
                {i.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.imageUrl} alt="" loading="lazy" className="size-full object-contain p-1.5 mix-blend-multiply" />
                ) : (
                  <Package className="size-6 text-[#b9b4a8]" strokeWidth={1.4} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`line-clamp-2 font-medium ${i.status === "purchased" ? "line-through" : ""}`} dir="auto">
                  {i.title}
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {src?.store}
                  {i.quantity > 1 && <span className="tabular"> · ×{i.quantity}</span>}
                </p>
              </div>
              <div className="shrink-0 text-end">
                {unit != null && <span className="price-tag text-[14px]">{formatMoney(unit, currency, locale)}</span>}
                {i.quantity > 1 && line != null && <div className="tabular mt-1 text-xs text-muted">{formatMoney(line, currency, locale)}</div>}
              </div>
              {src && (
                <a href={src.url} target="_blank" rel="noopener noreferrer" className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-fg" aria-label={t.item.openStore}>
                  <ExternalLink className="size-4" />
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
