"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/components/providers";
import { notifyAsk } from "@/app/notify-actions";
import { askHere, SETTLE_MS } from "@/lib/notify/ask";
import { askPermission, ensureSubscribed, permState } from "@/lib/notify/client";
import { useMedia } from "@/components/ui/use-media";
import { cn } from "@/lib/utils";
import { useScreen } from "../app/presence-beat";
import { useOpenItemId, useStore } from "../app/store";
import { inboxStore, useInbox } from "./inbox-state";
import { DESK } from "./inbox";
import { ICONS, Svg } from "./row";

// R17 S3 L — the reminder card after a "Not now": generic (no item, no price), the same card everywhere. Desktop: out of
// the header bell (tip pointing at it, the bell shows a dot). Phone: above the dock, in and out on the same path; a
// swipe down = Not now. The browser's own question is asked only on the "Turn on" tap.
//
// When (L1): the server says a card is due today (lib/notify/ask.ts askDue: switch on, the 3 → 7 → 14 → 30-day step,
// not shown today, not the first day after onboarding) AND here: permission isn't granted on this device, the screen is
// Home and has been settled ≥ 1.5 s with nothing open over it, not shopping.

type St = "offer" | "asking" | "on" | "blocked" | "blockedHow" | "iphone" | "iphoneHow" | "gone";

const KIND_TAG = "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z";
const KIND_TRUCK = "M1 3h15v13H1z M16 8h4l3 3v5h-7z";
const KIND_PEOPLE = "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z";
const WARN = "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 8v4 M12 16h.01";
const SHARE = "M12 3v12 M8 7l4-4 4 4 M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7";

/** Anything over Home: a sheet, a dialog, a panel, an item, the camera, a menu. */
function useOverlay() {
  const s = useStore();
  const item = useOpenItemId();
  return !!(s.panel || s.settingsSection != null || item || s.meOpen || s.paletteOpen || s.navOpen || s.reportDraft || s.scanner || s.editor);
}

export function AskCard() {
  const s = useStore();
  const { t } = useI18n();
  const a = t.nt.ask;
  const desk = useMedia(DESK);
  const { boot } = useInbox();
  const screen = useScreen();
  const overlay = useOverlay();
  const shopping = !!(s.shop && s.shop !== "pick");
  const [st, setSt] = useState<St | null>(null);
  const [settled, setSettled] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const shown = useRef(false);

  // Home settled: 1.5 s on Home with nothing over it (any open dialog in the page counts too).
  const calm = screen === "home" && !overlay && !shopping;
  useEffect(() => {
    if (!calm) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- leaving Home resets the settle timer
      setSettled(false);
      return;
    }
    const id = setTimeout(() => setSettled(!document.querySelector('[role=dialog]:not([data-nt-card]), [data-state=open][role=menu]')), SETTLE_MS);
    return () => clearTimeout(id);
  }, [calm]);

  // Enter once per page life when everything holds; the server remembers "shown today".
  useEffect(() => {
    if (shown.current || st || !boot?.askDue || !boot.on || !settled) return;
    const perm = permState();
    if (!askHere({ perm, screen: screen ?? "", settledMs: SETTLE_MS, overlay: false, shopping })) return;
    shown.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the card's entrance is decided here, once
    setSt(perm === "denied" ? "blocked" : perm === "iphone-browser" ? "iphone" : "offer");
    void notifyAsk("shown").catch(() => {});
  }, [boot, settled, st, screen, shopping]);

  // Leaving Home (or something opening over it) takes the card away for this page life — it is never in the way.
  useEffect(() => {
    if (st && st !== "gone" && st !== "asking" && (!calm || overlay)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the screen
      setSt("gone");
    }
  }, [calm, overlay, st]);

  const visible = st != null && st !== "gone";
  useEffect(() => {
    inboxStore.setAsk(visible && desk);
    return () => inboxStore.setAsk(false);
  }, [visible, desk]);

  const notNow = useCallback(() => {
    setSt("gone");
    void notifyAsk("no").catch(() => {});
  }, []);

  const turnOn = async () => {
    setSt("asking");
    const r = await askPermission();
    if (r === "granted") {
      void notifyAsk("yes").catch(() => {});
      const res = await ensureSubscribed(boot?.publicKey ?? null, true);
      setNote(res === "no-key" ? a.noServer : null);
      setSt("on");
      setTimeout(() => setSt("gone"), res === "no-key" ? 4000 : 2500);
    } else if (r === "denied") setSt("blocked");
    else notNow(); // closed the browser's question without answering
  };

  const recheck = async () => {
    if (permState() === "granted") {
      void notifyAsk("yes").catch(() => {});
      await ensureSubscribed(boot?.publicKey ?? null, true);
      setNote(null);
      setSt("on");
      setTimeout(() => setSt("gone"), 2500);
    } else setNote(a.stillBlocked);
  };

  if (st == null) return null;
  const phone = !desk;
  let title = a.title;
  let line = note ?? a.line;
  let markD = ICONS.BELL;
  let mark = "";
  let kinds = true;
  let steps: string[] | null = null;
  let buttons: { label: string; onClick: () => void; pri?: boolean; wait?: boolean; key: string }[] = [
    { key: "later", label: a.notNow, onClick: notNow },
    { key: "on", label: a.turnOn, onClick: () => void turnOn(), pri: true },
  ];
  if (st === "asking") {
    line = phone ? a.answerPhone : a.answer;
    buttons = [{ key: "wait", label: a.waiting, onClick: () => {}, pri: true, wait: true }];
  }
  if (st === "on") {
    title = a.on;
    line = note ?? a.onLine;
    markD = ICONS.CHECK;
    mark = " ok";
    kinds = false;
    buttons = [];
  }
  if (st === "blocked" || st === "blockedHow") {
    title = a.blockedT;
    line = note ?? (phone ? a.threeTaps : a.threeClicks);
    markD = WARN;
    mark = " warn";
    kinds = false;
    if (st === "blockedHow") steps = phone ? [a.step1Phone, a.step2Phone, a.step3Phone] : [a.step1, a.step2, a.step3];
    buttons = [
      { key: "later", label: a.notNow, onClick: notNow },
      st === "blocked" ? { key: "how", label: t.nt.how, onClick: () => setSt("blockedHow"), pri: true } : { key: "allowed", label: a.allowed, onClick: () => void recheck(), pri: true },
    ];
  }
  if (st === "iphone" || st === "iphoneHow") {
    title = a.iphoneT;
    line = a.iphoneLine;
    markD = SHARE;
    mark = " ios";
    kinds = false;
    if (st === "iphoneHow") steps = [a.iphone1, a.iphone2, a.iphone3];
    buttons = [
      { key: "later", label: a.notNow, onClick: notNow },
      st === "iphone" ? { key: "how", label: a.showHow, onClick: () => setSt("iphoneHow"), pri: true } : { key: "added", label: a.addedIt, onClick: () => setSt("gone"), pri: true },
    ];
  }

  const card = (
    <>
      <div className="row">
        <span className={`kinds${mark}`} aria-hidden>
          <span className="b">
            <Svg d={markD} />
          </span>
          {kinds && (
            <>
              <span className="k k1">
                <Svg d={KIND_TAG} />
              </span>
              <span className="k k2">
                <Svg d={KIND_TRUCK} />
              </span>
              <span className="k k3">
                <Svg d={KIND_PEOPLE} />
              </span>
            </>
          )}
        </span>
        <span className="tx" aria-live="polite">
          <b>{title}</b>
          <span>{line}</span>
        </span>
      </div>
      {steps && (
        <div className="steps grow-in">
          {steps.map((x, i) => (
            <div key={i}>
              <span className="n">{i + 1}</span>
              <span>{x}</span>
            </div>
          ))}
        </div>
      )}
      {buttons.length > 0 && (
        <div className="bt">
          {buttons.map((b) => (
            <button key={b.key} type="button" className={cn("btn", b.pri ? "pri" : "ghost", b.wait && "wait")} onClick={b.onClick} disabled={b.wait} data-nt-card-btn={b.key}>
              {b.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
  return desk ? <DeskCard gone={st === "gone"} onDone={() => setSt(null)} label={a.aria}>{card}</DeskCard> : <PhoneCard gone={st === "gone"} onDone={() => setSt(null)} onSwipe={notNow} label={a.aria}>{card}</PhoneCard>;
}

/** Desktop: a popover from the header bell, tip pointing at it. */
function DeskCard({ gone, onDone, label, children }: { gone: boolean; onDone: () => void; label: string; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ top: number; end: number; tip: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const b = document.querySelector<HTMLElement>('[data-nt-bell="desk"]')?.getBoundingClientRect();
      const rtl = document.documentElement.dir === "rtl";
      if (!b) return setPos({ top: 72, end: 24, tip: 22 });
      const end = Math.max(12, rtl ? b.left - 8 : window.innerWidth - b.right - 8);
      // The tip sits under the bell's middle.
      const tip = Math.max(14, (rtl ? b.left + b.width / 2 - end : window.innerWidth - end - (b.left + b.width / 2)) - 6);
      setPos({ top: b.bottom + 12, end, tip });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);
  useEffect(() => {
    if (!gone) return;
    const id = setTimeout(onDone, 220);
    return () => clearTimeout(id);
  }, [gone, onDone]);
  if (!pos) return null;
  return createPortal(
    <section className={cn("nx nudge-pc", gone && "gone")} style={{ top: pos.top, insetInlineEnd: pos.end, ["--tip" as string]: `${pos.tip}px` }} dir={document.documentElement.dir} role="dialog" aria-modal="false" aria-label={label} data-nt-card="desk">
      <span className="tip" aria-hidden />
      <div className="nudge">{children}</div>
    </section>,
    document.body,
  );
}

/** Phone: above the dock; a downward swipe dismisses (= Not now). */
function PhoneCard({ gone, onDone, onSwipe, label, children }: { gone: boolean; onDone: () => void; onSwipe: () => void; label: string; children: React.ReactNode }) {
  const [dy, setDy] = useState<number | null>(null);
  const d = useRef<{ y0: number; t0: number } | null>(null);
  useEffect(() => {
    if (!gone) return;
    const id = setTimeout(onDone, 420);
    return () => clearTimeout(id);
  }, [gone, onDone]);
  return createPortal(
    <section
      className={cn("nx nudge-ph", gone && "gone", dy != null && "dragging")}
      style={dy != null ? { transform: `translateY(${dy}px)`, opacity: Math.max(0.2, 1 - dy / 160) } : undefined}
      dir={document.documentElement.dir}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      data-nt-card="phone"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        d.current = { y0: e.clientY, t0: performance.now() };
      }}
      onPointerMove={(e) => {
        if (!d.current) return;
        const v = e.clientY - d.current.y0;
        if (v > 4) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDy(v > 0 ? v : v * 0.2);
      }}
      onPointerUp={() => {
        const c = d.current;
        d.current = null;
        if (!c || dy == null) return setDy(null);
        const vel = dy / Math.max(1, performance.now() - c.t0);
        setDy(null);
        if (dy > 60 || vel > 0.5) onSwipe();
      }}
      onPointerCancel={() => ((d.current = null), setDy(null))}
    >
      <div className="nudge">{children}</div>
    </section>,
    document.body,
  );
}
