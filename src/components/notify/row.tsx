"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/providers";
import type { InboxRow } from "@/app/notify-actions";
import type { ActivityData, DeliveryData, PriceData, ShopData } from "@/lib/notify/kinds";
import { rowText, whenText } from "@/lib/notify/text";
import { useStore } from "../app/store";
import { inboxStore, useInbox } from "./inbox-state";

// R17 S3 K3 — one inbox row (popover and phone page). The media column is a fixed 40×40 block: faces, pictures and
// kind badges all sit inside it (the board's v2 fix — test:inbox checks every badge box is inside its row).

const BELL = "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0";
const TAG = "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z M7.5 7.5h.01";
const TRUCK = "M1 3h15v13H1z M16 8h4l3 3v5h-7z M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z";
const WALLET = "M3 7a2 2 0 0 1 2-2h13v4 M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z M16 14h.01";
const CHART = "M3 3v18h18 M7 15l4-4 3 3 5-6";
const CHECK = "M20 6 9 17l-5-5";
const TRASH = "M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6";
export const ICONS = { BELL, TAG, TRUCK, WALLET, CHART, CHECK, TRASH };

export const Svg = ({ d, className }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <path d={d} />
  </svg>
);

/** A stable avatar colour per person (c1…c6 of the kit). */
const colorOf = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return `c${(Math.abs(h) % 6) + 1}`;
};
const initial = (name: string) => (name.trim()[0] ?? "·").toUpperCase();

function Media({ row }: { row: InboxRow }) {
  const s = useStore();
  if (row.kind === "shop") {
    const d = row.data as ShopData;
    return (
      <span className="media" data-media>
        <span className={`av lg ${colorOf(d.whoId || d.who)} ${d.done ? "" : "ring-shop"}`} data-badge>
          {initial(d.who)}
        </span>
      </span>
    );
  }
  if (row.kind === "activity") {
    const d = row.data as ActivityData;
    const [a, b] = [d.names[0] ?? "", d.names[1] ?? d.names[0] ?? ""];
    return (
      <span className="media" data-media>
        <span className="pile-n">
          <span className={`av sm ${colorOf(d.byIds[0] ?? a)}`} data-badge>
            {initial(a)}
          </span>
          <span className={`av sm ${colorOf(d.byIds[1] ?? d.byIds[0] ?? b)}`} data-badge>
            {initial(b)}
          </span>
        </span>
      </span>
    );
  }
  if (row.kind === "price" || row.kind === "delivery") {
    const d = row.data as PriceData | DeliveryData;
    const pic = s.items.find((i) => i.id === d.itemId)?.imageUrl ?? d.pic ?? null;
    return (
      <span className="media" data-media>
        <span className="thumb">
          {/* eslint-disable-next-line @next/next/no-img-element -- item pictures are already sized thumbnails */}
          {pic ? <img src={pic} alt="" loading="lazy" decoding="async" /> : null}
          <span className={`kb ${row.kind === "price" ? "ok" : "info"}`} data-badge>
            <Svg d={row.kind === "price" ? TAG : TRUCK} />
          </span>
        </span>
      </span>
    );
  }
  return (
    <span className="media" data-media>
      <span className={`nic ${row.kind === "budget" ? "k-budget" : "k-week"}`} data-badge>
        <Svg d={row.kind === "budget" ? WALLET : CHART} />
      </span>
    </span>
  );
}

/** Text that changed in place (the trip finished) crossfades with a short blur. */
function useSwapKey(v: string) {
  const prev = useRef(v);
  const [k, setK] = useState(0);
  useEffect(() => {
    if (prev.current !== v) {
      prev.current = v;
      setK((x) => x + 1); // re-key the text so the crossfade replays
    }
  }, [v]);
  return k;
}

export function NotifyRow({ row, now, onOpen }: { row: InboxRow; now: number; onOpen: (r: InboxRow) => void }) {
  const { t, locale } = useI18n();
  const nt = t.nt;
  const { received } = useInbox();
  const tx = rowText(row.kind, row.data, nt, locale);
  const swap = useSwapKey(tx.title);
  const done = tx.done || !!received[row.id];
  return (
    <div className={`nt${row.read ? "" : " unread"}`} data-nt={row.kind} data-nt-id={row.id} data-read={row.read ? "1" : "0"}>
      <button type="button" className="nt-hit" onClick={() => onOpen(row)} aria-label={`${tx.title}. ${tx.sub}`} />
      <Media row={row} />
      <span key={swap} className={`tx${swap ? " swap" : ""}`}>
        <b className="bidi">{tx.title}</b>
        {tx.sub && (
          <span className="s bidi" dir="auto">
            {tx.sub}
          </span>
        )}
        {tx.price && (
          <span style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, fontSize: 13 }}>
            <b className="num">{tx.price.now}</b>
            {tx.price.was && <span className="was num">{tx.price.was}</span>}
            <span className="chg" dir="ltr">{tx.price.chg}</span>
          </span>
        )}
        {tx.meter != null && (
          <span className="meter" style={{ marginTop: 8 }}>
            <i style={{ width: `${Math.round(tx.meter * 100)}%`, background: tx.meter >= 1 ? "var(--danger)" : "var(--warn)" }} />
          </span>
        )}
        {tx.live && (
          <span className="shopping" style={{ marginTop: 8 }}>
            <span className="ping" />
            {tx.live}
          </span>
        )}
        {tx.action && (
          <span className="act">
            {tx.action === "received" ? (
              done ? (
                <span className="donechip" data-nt-done>
                  <Svg d={CHECK} />
                  {nt.markedReceived}
                </span>
              ) : (
                <button type="button" className="btn sm" onClick={() => void inboxStore.received(row.id)} data-nt-received>
                  {nt.received}
                </button>
              )
            ) : (
              <button type="button" className="btn sm" onClick={() => onOpen(row)} data-nt-open>
                {nt.open}
              </button>
            )}
          </span>
        )}
        {!tx.action && row.kind === "delivery" && done && (
          <span className="act">
            <span className="donechip" data-nt-done>
              <Svg d={CHECK} />
              {nt.markedReceived}
            </span>
          </span>
        )}
      </span>
      <span className="meta">
        <span>{whenText(row.at, now, nt, locale)}</span>
        <span className={`udot${row.read ? " off" : ""}`} aria-hidden />
      </span>
    </div>
  );
}
