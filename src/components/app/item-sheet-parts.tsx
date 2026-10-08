"use client";

import { DeliveryTrack } from "./delivery-track";
import { deliveryTrack } from "@/lib/home";
import { useMemo, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { BellRing, ExternalLink, Search, FileText, Paperclip, Split, Trash2, TrendingDown, Truck } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/lib/toast";
import { addAttachment, deleteAttachment, updateItem } from "@/app/actions";
import { useI18n } from "@/components/providers";
import { Input, Label } from "@/components/ui/button";
import { lowestSeen } from "@/lib/calc";
import { convert, formatMoney } from "@/lib/money";
import type { ItemWithSources } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useStatusFlow, type Status } from "./item-card";
import { useStore } from "./store";
import { useSaveItem } from "./conflicts";
import { storeSearches } from "@/lib/search-links";

/** A titled card inside the item sheet. */
export function Group({ title, icon: Icon, aside, children, className }: { title: string; icon: React.ComponentType<{ className?: string }>; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-line bg-surface", className)}>
      <header className="flex min-h-11 items-center justify-between gap-2 px-4 pt-1">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-fg">
          <Icon className="size-4 text-faint" />
          {title}
        </h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** A label/control row inside a Group (settings-list style). */
export function Row({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-12 items-center justify-between gap-3 border-t border-line/70 px-4 py-2", className)}>
      <span className="shrink-0 text-[13.5px] text-muted">{label}</span>
      {children}
    </div>
  );
}

/** To buy → Ordered → Received as one segmented control. */
export function StatusControl({ item }: { item: ItemWithSources }) {
  const { t } = useI18n();
  const flow = useStatusFlow();
  const steps: { value: Status; label: string }[] = [
    { value: "to_buy", label: t.flow.toBuy },
    { value: "ordered", label: t.flow.ordered },
    { value: "purchased", label: t.flow.received },
  ];
  const idx = steps.findIndex((x) => x.value === item.status);
  return (
    <div role="radiogroup" aria-label={t.select.status} className="relative grid grid-cols-3 rounded-lg border border-line-strong bg-bg p-0.5 text-[13px]">
      {steps.map((st, i) => (
        <button
          key={st.value}
          type="button"
          role="radio"
          aria-checked={item.status === st.value}
          onClick={() => item.status !== st.value && void flow.setTo(item, st.value)}
          className={cn(
            "hit h-8 rounded-md px-3 font-medium transition",
            item.status === st.value
              ? st.value === "ordered"
                ? "bg-info text-white"
                : st.value === "purchased"
                  ? "bg-ok text-white"
                  : "bg-fg text-bg"
              : i < idx
                ? "text-fg/70 hover:text-fg"
                : "text-muted hover:text-fg",
          )}
        >
          {st.label}
        </button>
      ))}
    </div>
  );
}

// Common formats: Israel Post (RR123456789IL), Cainiao/AliExpress, UPS, DHL, FedEx.
function guessCarrier(num: string) {
  const n = num.trim().toUpperCase();
  if (/^[A-Z]{2}\d{9}IL$/.test(n)) return "Israel Post";
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return "UPS";
  if (/^(LP|CN|YT|UB|AE|CAINIAO)/.test(n) || /^[A-Z]{2}\d{9}CN$/.test(n)) return "Cainiao";
  if (/^\d{10}$/.test(n)) return "DHL";
  if (/^\d{12}$|^\d{15}$/.test(n)) return "FedEx";
  return null;
}

export function trackingUrl(num: string) {
  return `https://parcelsapp.com/en/tracking/${encodeURIComponent(num.trim())}`;
}

export function ShippingSection({ item }: { item: ItemWithSources }) {
  const s = useStore();
  const { t, f } = useI18n();
  const saveItem = useSaveItem();
  const save = (patch: Parameters<typeof updateItem>[1]) => saveItem(item, patch);
  const etaValue = item.eta ? new Date(item.eta).toISOString().slice(0, 10) : "";
  return (
    <section className="rounded-2xl border border-info/30 bg-info/5 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Truck className="size-4 text-info" />
        {t.track.title}
        {item.orderNumber && (
          <span className="tabular ms-auto truncate text-xs font-normal text-muted" data-order-number>
            {f(t.track.orderNo, { n: item.orderNumber })}
          </span>
        )}
      </div>
      {/* Round 13 B4: the same delivery track as Home and the On the way list. */}
      <DeliveryTrack track={deliveryTrack(item, s.clock.now, s.clock.tz)} labels className="mb-4" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="trk">{t.track.number}</Label>
          <div className="flex gap-2">
            <Input
              id="trk"
              key={item.id + (item.trackingNumber ?? "")}
              dir="ltr"
              defaultValue={item.trackingNumber ?? ""}
              className="h-9 font-medium tracking-wide"
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v === item.trackingNumber) return;
                void save({ trackingNumber: v, ...(v && !item.carrier ? { carrier: guessCarrier(v) } : {}) });
              }}
            />
            {item.trackingNumber && (
              <a
                href={trackingUrl(item.trackingNumber)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-info px-3 text-[13px] font-medium text-white hover:brightness-110"
              >
                <ExternalLink className="size-3.5" />
                {t.track.open}
              </a>
            )}
          </div>
        </div>
        <div>
          <Label htmlFor="carrier">{t.track.carrier}</Label>
          <Input
            id="carrier"
            key={item.id + (item.carrier ?? "")}
            list="carriers"
            defaultValue={item.carrier ?? ""}
            placeholder={t.track.auto}
            className="h-9"
            onBlur={(e) => (e.target.value.trim() || null) !== item.carrier && save({ carrier: e.target.value.trim() || null })}
          />
          <datalist id="carriers">
            {["Israel Post", "Cainiao", "UPS", "DHL", "FedEx", "Amazon", "Yanwen", "4PX", "Cheetah", "Hfd"].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <Label htmlFor="eta">{t.track.eta}</Label>
          <Input
            id="eta"
            type="date"
            key={item.id + etaValue}
            defaultValue={etaValue}
            className="h-9"
            onChange={(e) => {
              const v = e.target.value ? new Date(e.target.value + "T12:00:00").getTime() : null;
              if (v !== item.eta) void save({ eta: v });
            }}
          />
        </div>
      </div>
    </section>
  );
}

/** Small line chart of every price observation, in the display currency. */
export function PriceHistory({ item }: { item: ItemWithSources }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const pts = useMemo(
    () =>
      item.points
        .map((p) => {
          const src = item.sources.find((x) => x.id === p.sourceId);
          return { at: p.recordedAt, v: convert(p.price + (src?.shipping ?? 0), p.currency, s.currency, s.rates), store: src?.store ?? "" };
        })
        .sort((a, b) => a.at - b.at),
    [item.points, item.sources, s.currency, s.rates],
  );
  const low = lowestSeen(item, s.rates, s.currency);

  if (pts.length < 2) return <p className="px-4 pb-3.5 text-xs leading-relaxed text-muted">{t.history.empty}</p>;

  const W = 440;
  const H = 96;
  const PAD = 8;
  const t0 = pts[0].at;
  const t1 = pts[pts.length - 1].at;
  const vMin = Math.min(...pts.map((p) => p.v));
  const vMax = Math.max(...pts.map((p) => p.v));
  const x = (at: number) => PAD + ((at - t0) / Math.max(1, t1 - t0)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - (v - vMin) / Math.max(1e-9, vMax - vMin)) * (H - PAD * 2);
  // Step line: a price holds until the next reading.
  let d = `M${x(pts[0].at)},${y(pts[0].v)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i].at)} V${y(pts[i].v)}`;
  const hp = hover != null ? pts[hover] : null;
  const date = (ms: number) => new Date(ms).toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short", year: "2-digit" });

  return (
    <div className="px-3 pb-3">
      <div className="relative rounded-xl bg-sunken/60 p-2" dir="ltr">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-24 w-full overflow-visible"
          role="img"
          aria-label={`${t.history.title}: ${formatMoney(vMin, s.currency, locale)} – ${formatMoney(vMax, s.currency, locale)}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = svgRef.current!.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            let best = 0;
            pts.forEach((p, i) => {
              if (Math.abs(x(p.at) - px) < Math.abs(x(pts[best].at) - px)) best = i;
            });
            setHover(best);
          }}
        >
          <line x1={PAD} x2={W - PAD} y1={y(vMin)} y2={y(vMin)} className="stroke-line" strokeDasharray="3 4" />
          <path d={d} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {pts.map((p, i) => (
            <circle key={i} cx={x(p.at)} cy={y(p.v)} r={hover === i ? 5 : 3} className={cn("fill-accent stroke-surface", hover === i && "fill-fg")} strokeWidth={2} />
          ))}
        </svg>
        {hp && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-line bg-raised px-2.5 py-1.5 text-xs shadow-pop"
            style={{ left: `${(x(hp.at) / W) * 100}%` }}
          >
            <div className="tabular font-semibold">{formatMoney(hp.v, s.currency, locale)}</div>
            <div className="text-muted">
              {date(hp.at)} · {hp.store}
            </div>
          </div>
        )}
        <div className="mt-1 flex justify-between text-[11px] text-faint">
          <span>{date(t0)}</span>
          <span>{f(t.history.points, { n: pts.length })}</span>
          <span>{date(t1)}</span>
        </div>
      </div>
    </div>
  );
}

/** Lowest price seen, for the price section header. */
export function LowestBadge({ item }: { item: ItemWithSources }) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const low = item.points.length > 1 ? lowestSeen(item, s.rates, s.currency) : null;
  if (low == null) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-ok">
      <TrendingDown className="size-3.5" />
      {f(t.history.lowest, { amount: formatMoney(low, s.currency, locale) })}
    </span>
  );
}

export function ReceiptsSection({ item }: { item: ItemWithSources }) {
  const s = useStore();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      let latest = item;
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024) throw new Error("too_big");
        const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "receipt";
        const blob = await upload(`spaces/${s.spaceId}/receipts/${item.id}/${safe}`, file, { access: "public", handleUploadUrl: "/api/blob/upload", contentType: file.type || undefined });
        latest = await addAttachment(item.id, { url: blob.url, name: file.name, contentType: file.type || null, size: file.size });
      }
      s.upsertItem(latest);
      toast.success(t.receipts.added);
    } catch {
      toast.error(t.receipts.failed);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Group
      title={t.receipts.title}
      icon={Paperclip}
      aside={
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-accent-ink hover:bg-accent-soft disabled:opacity-60"
        >
          {busy ? <Spinner className="size-3.5" /> : <Paperclip className="size-3.5" />}
          {busy ? t.receipts.uploading : t.receipts.add}
        </button>
      }
    >
      <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
      <div className="px-4 pb-4">
      {item.attachments.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {item.attachments.map((a) => (
            <li key={a.id} className="group relative overflow-hidden rounded-lg border border-line bg-bg/40">
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="block">
                {a.contentType?.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.name} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                ) : (
                  <div className="grid aspect-[4/3] place-items-center bg-sunken">
                    <FileText className="size-7 text-muted" strokeWidth={1.5} />
                  </div>
                )}
                <div className="truncate px-2 py-1.5 text-[11px] text-muted bidi">
                  {a.name}
                </div>
              </a>
              <button
                type="button"
                aria-label={t.receipts.remove}
                title={t.receipts.remove}
                onClick={async () => s.upsertItem(await deleteAttachment(a.id))}
                className="absolute end-1.5 top-1.5 grid size-7 place-items-center rounded-md bg-black/60 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFiles(e.dataTransfer.files);
          }}
          className="w-full rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-xs text-muted transition hover:border-accent hover:text-fg"
        >
          {t.receipts.add}
        </button>
      )}
      </div>
    </Group>
  );
}

export function AltLink({ item }: { item: ItemWithSources }) {
  const s = useStore();
  const { t, f } = useI18n();
  const group = item.altGroupId ? s.altGroups.find((g) => g.id === item.altGroupId) : null;
  if (!group) return null;
  const n = s.items.filter((i) => i.altGroupId === group.id).length;
  return (
    <button
      type="button"
      onClick={() => {
        s.openItem(null);
        s.openAlt(group.id);
      }}
      className="mt-3 flex w-full items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft/50 px-3 py-2 text-start text-sm text-accent-ink transition hover:bg-accent-soft"
    >
      <Split className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate bidi">
        {group.name}
      </span>
      <span className="shrink-0 text-xs">{f(t.alt.badge, { n })}</span>
    </button>
  );
}

/** Watch toggle + target price. The daily check alerts when the price drops or reaches the target. */
export function PriceWatch({ item, save }: { item: ItemWithSources; save: (p: { watch?: boolean; targetPrice?: number | null; targetCurrency?: string | null }) => Promise<void> }) {
  const s = useStore();
  const { t } = useI18n();
  const cur = item.targetCurrency ?? s.currency;
  return (
    <>
      <Row
        label={
          <span className="flex flex-col">
            <span className="flex items-center gap-2 text-fg">
              <BellRing className="size-4 text-faint" />
              {t.alerts.watch}
            </span>
            <span className="mt-0.5 text-xs text-faint">{t.alerts.watchHint}</span>
          </span>
        }
      >
        <button
          type="button"
          role="switch"
          aria-checked={item.watch}
          aria-label={t.alerts.watch}
          onClick={() => void save({ watch: !item.watch })}
          className={cn("relative h-6 w-11 shrink-0 rounded-full transition", item.watch ? "bg-accent" : "bg-line-strong")}
        >
          <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-[inset-inline-start]", item.watch ? "start-[22px]" : "start-0.5")} />
        </button>
      </Row>
      {item.watch && (
        <Row label={<label htmlFor="target">{t.alerts.target}</label>}>
          <div className="flex">
            <input
              id="target"
              key={item.targetPrice ?? "none"}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              defaultValue={item.targetPrice ?? ""}
              placeholder={t.alerts.targetPlaceholder}
              onBlur={(e) => {
                const v = e.target.value.trim() === "" ? null : Math.max(0, Number(e.target.value));
                if (v !== item.targetPrice && !Number.isNaN(v)) void save({ targetPrice: v, targetCurrency: v == null ? null : cur });
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="tabular h-9 w-28 rounded-s-lg border border-line-strong bg-bg px-2.5 text-sm outline-none focus:border-accent"
            />
            <span className="grid h-9 place-items-center rounded-e-lg border border-s-0 border-line-strong bg-sunken px-2.5 text-xs text-muted">{cur}</span>
          </div>
        </Row>
      )}
    </>
  );
}

/** For items without a store link yet: jump to store searches, then paste the link into the item. */
export function FindIt({ query }: { query: string }) {
  const { t } = useI18n();
  return (
    <section>
      <div className="rounded-2xl border border-dashed border-accent/50 bg-accent-soft/30 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Search className="size-4 text-accent-ink" />
          {t.ai.findIn}
        </div>
        <p className="mt-0.5 text-xs text-muted">{t.ai.findHint}</p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {storeSearches(query).map((st) => (
            <a
              key={st.name}
              href={st.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium transition hover:border-accent hover:text-accent-ink"
            >
              {st.name}
              <ExternalLink className="size-3.5 opacity-60" />
            </a>
          ))}
        </div>
        <p className="mt-2 truncate text-[11px] text-faint" dir="ltr">
          “{query}”
        </p>
      </div>
    </section>
  );
}
