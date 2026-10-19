"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/components/providers";
import { useDevice } from "@/components/ui/use-device";
import { dockOf } from "@/lib/dock";
import { cn } from "@/lib/utils";
import { useStore } from "./store";
import { useSmHome } from "./supermarket/data";
import { useTrips } from "./supermarket/numbers";
import { useLocalTrip } from "./supermarket/local-trip";

// R18 S5 C1–C3 (boards Ask-final-phone, Ask-fab-phone, List-desktop, Home-widgets-desktop, Spending-month-desktop) — the
// floating "Ask Nexus": a pearl orb with a 2 px AI ring (muted at rest), two stars optically centred (CSS `translate`, so
// a pressed / thinking scale never undoes it). Always a perfect, fully opaque circle (CLAUDE.md; the gap between orb and
// ring is the pearl's edge colour). Phone: fixed 12 px above the dock on the physical right (or left: Settings → Display
// → AI button side, `pref:ask-side`), on the main tabs only; rises over toasts / the added pill (340 ms drawer ease);
// hidden in store mode, Home edit mode, the camera, any open sheet / dialog and while the keyboard is open. Computer:
// 52 px (R19 A1; phone 48 px) in the content area's bottom corner (never over the sidebar). Tap → the chat, opening from the button (a circle
// reveal from its centre; reduced motion: a fade). States: message (ring turns, amber dot, one hop, a 6 s bubble),
// thinking (any AI work: html[data-ai-busy]), listening (voice to Nexus), offline (grey).

export type AskSide = "right" | "left";
const SEEN_KEY = "nexus.askSeen";
const SPRING = "cubic-bezier(.34,1.25,.64,1)";

const reduced = () => typeof window !== "undefined" && (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.getAttribute("data-motion") === "reduce");

/** The two stars (24-unit box): the big one in spark, the small one in ink (Plum: plum; dark: white). */
export function AskStars({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("ask-stars", className)} aria-hidden>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  );
}

/** Voice to Nexus (Ask-configs "listening"): whoever records sets `data-ask-listening` on <html>. */
export function setAskListening(on: boolean) {
  if (on) document.documentElement.setAttribute("data-ask-listening", "");
  else document.documentElement.removeAttribute("data-ask-listening");
}

/** What Nexus has for you (C2: from what it already surfaces): the staples due on the supermarket list. */
function useAskMessage() {
  const s = useStore();
  const { f, t } = useI18n();
  const { home } = useSmHome();
  const due = (home?.suggestions ?? []).filter((x) => x.reasonKey === "due");
  if (!due.length) return null;
  const key = `due:${due.map((x) => x.productKey).sort().join(",")}:${new Date(s.clock.now).toDateString()}`;
  return { key, text: due.length === 1 ? f(t.ask.dueOne, { title: due[0].title }) : f(t.ask.due, { n: due.length }) };
}

export function AskFab() {
  const s = useStore();
  const { t, dir } = useI18n();
  const device = useDevice();
  const phone = device === "phone";
  const side: AskSide = s.homePrefs.askSide === "left" ? "left" : "right";
  const btn = useRef<HTMLButtonElement>(null);
  const [rise, setRise] = useState(0);
  const [kb, setKb] = useState(false);
  const [box, setBox] = useState<{ left: number; right: number } | null>(null);
  const msg = useAskMessage();
  const { mine } = useTrips(useSmHome().home);
  const local = useLocalTrip(s.spaceId || "-");
  const tripOn = mine != null || local != null;
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [bubble, setBubble] = useState<string | null>(null);
  const offline = s.offlineAt != null;
  const onTab = phone ? dockOf(s.view.type) != null : true;
  const shown = s.aiEnabled && onTab && !kb;

  // Seen messages (this device): a message bubbles once, its dot stays until the button is opened.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- this device's seen list (browser only)
      setSeen(new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]));
    } catch {}
  }, []);
  const remember = (k: string) => {
    setSeen((x) => {
      const next = new Set([...x, k]);
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify([...next].slice(-30)));
      } catch {}
      return next;
    });
  };
  const fresh = msg && !seen.has(msg.key) && !tripOn ? msg : null;
  // One bubble per message (6 s), never during a trip; the timers outlive re-renders (only unmount clears them).
  const bubbled = useRef(new Set<string>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const freshKey = fresh?.key ?? null;
  const freshText = fresh?.text ?? "";
  useEffect(() => {
    if (!freshKey || !shown || bubbled.current.has(freshKey)) return;
    bubbled.current.add(freshKey);
    timers.current.push(setTimeout(() => setBubble(freshText), 400), setTimeout(() => setBubble(null), 6400));
  }, [freshKey, freshText, shown]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Rise over whatever sits in the button's column (toasts, the added pill); on phones the keyboard hides it.
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const b = btn.current;
      if (!b) return;
      const r = b.getBoundingClientRect();
      // Where the button's bottom rests (its CSS `bottom`, not the rect — that moves with the rise's own transition).
      const base = window.innerHeight - (parseFloat(getComputedStyle(b).bottom) || 0);
      let top = base;
      for (const el of document.querySelectorAll<HTMLElement>("[data-sonner-toast], .sm-added-pill, [data-ask-rise]")) {
        const e = el.getBoundingClientRect();
        if (!e.height || e.right < r.left - 4 || e.left > r.right + 4 || e.top > base) continue;
        top = Math.min(top, e.top - 8);
      }
      const next = Math.max(0, Math.round(base - top));
      setRise((cur) => (Math.abs(cur - next) > 1 ? next : cur));
    };
    // A toast slides in after it mounts: measure now and once more when its entry has settled.
    let late: ReturnType<typeof setTimeout>[] = [];
    const kick = () => {
      raf ||= requestAnimationFrame(measure);
      late.forEach(clearTimeout);
      late = [200, 450, 900].map((ms) => setTimeout(() => (raf ||= requestAnimationFrame(measure)), ms));
    };
    const mo = new MutationObserver(kick);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-visible", "data-removed", "data-mounted", "data-front", "style", "class"] });
    const vv = window.visualViewport;
    const onVv = () => setKb(!!vv && window.innerHeight - vv.height > 150);
    vv?.addEventListener("resize", onVv);
    kick();
    return () => {
      mo.disconnect();
      vv?.removeEventListener("resize", onVv);
      cancelAnimationFrame(raf);
      late.forEach(clearTimeout);
    };
  }, [phone]);

  // Computer: the content area's edges (the button never sits over the sidebar).
  useEffect(() => {
    if (phone) return;
    const main = document.querySelector<HTMLElement>("[data-app-content]") ?? document.querySelector("main");
    if (!main) return;
    // The sidebar's side uses the content column's edge; the other side is the window's edge (the board: 28 px in).
    const read = () => {
      const r = main.getBoundingClientRect();
      const w = document.documentElement.clientWidth;
      const rtl = document.documentElement.dir === "rtl";
      setBox({ left: rtl ? 0 : Math.max(0, r.left), right: rtl ? Math.max(0, w - r.right) : 0 });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(main);
    window.addEventListener("resize", read);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", read);
    };
  }, [phone]);

  // Changing the side slides the button across once (420 ms spring).
  const lastX = useRef<number | null>(null);
  useLayoutEffect(() => {
    const b = btn.current;
    if (!b) return;
    const x = b.getBoundingClientRect().left;
    if (lastX.current != null && Math.abs(lastX.current - x) > 4 && !reduced()) b.animate([{ translate: `${lastX.current - x}px 0` }, { translate: "0 0" }], { duration: 420, easing: SPRING });
    lastX.current = x;
  }, [side, box?.left, box?.right]);

  const open = () => {
    const b = btn.current;
    if (!b || offline) return;
    if (msg) remember(msg.key);
    setBubble(null);
    const r = b.getBoundingClientRect();
    const root = document.documentElement;
    root.style.setProperty("--ask-x", `${Math.round(r.left + r.width / 2)}px`);
    root.style.setProperty("--ask-y", `${Math.round(r.top + r.height / 2)}px`);
    root.setAttribute("data-ask-from", "");
    setTimeout(() => root.removeAttribute("data-ask-from"), 700);
    s.setPanel("assistant");
  };

  if (!s.aiEnabled) return null;
  const size = phone ? 48 : 52; // R19 A1: smaller (was 58 / 60)
  const edge = phone ? 12 : 28;
  const pos: React.CSSProperties = phone
    ? { [side]: `calc(${edge}px + env(safe-area-inset-${side}))`, bottom: "calc(92px + env(safe-area-inset-bottom))" }
    : { [side]: (box ? (side === "left" ? box.left : box.right) : 0) + edge, bottom: 28 };
  return (
    <>
      {bubble && shown && (
        <button
          type="button"
          className="ask-bubble"
          style={{ ...pos, bottom: phone ? `calc(${92 + size + 12 + rise}px + env(safe-area-inset-bottom))` : 28 + size + 12, textAlign: dir === "rtl" ? "right" : "left" }}
          onClick={open}
          data-ask-bubble
        >
          <span className="ask-bubble-who">Nexus</span>
          <span className="bidi">{bubble}</span>
        </button>
      )}
      <button
        ref={btn}
        type="button"
        className={cn("ask-fab", phone ? "ask-fab-phone" : "ask-fab-desk", fresh && "ask-msg", offline && "ask-off", !shown && "ask-hidden")}
        style={{ ...pos, width: size, height: size, transform: rise ? `translateY(${-rise}px)` : undefined }}
        onClick={open}
        aria-label={t.ai.openAssistant}
        title={t.ai.openAssistant}
        aria-hidden={!shown || undefined}
        tabIndex={shown ? undefined : -1}
        disabled={offline}
        data-ask-fab={side}
        data-ask
        data-ask-rise-by={rise || undefined}
        data-carry="panel:assistant"
      >
        <AskStars />
        <span className="ask-bars" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        {fresh && <span className="ask-dot" aria-hidden data-ask-dot />}
      </button>
    </>
  );
}
