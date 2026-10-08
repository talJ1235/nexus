"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/providers";
import type { SpaceCard } from "@/lib/types";
import { useStore } from "../store";
import { deepOf, gradientOf } from "./look";
import { Facepile } from "./space-ui";
import { SpaceTile } from "./tile";
import { EASE_OUT } from "@/lib/motion";

/**
 * R16 D4 — "You're now in Jacoby Home": on a space switch the tile flies from the switcher to the centre (a shared
 * element: a clone animated from the source tile's box), a wash of the space colour fills the screen, the name and the
 * faces come in; ≈ 800 ms, then it lifts off Home with the new space's data already swapped in underneath. The data
 * loads during it; not ready → it holds with a thin progress line, up to 3 s, then gives way to Home's skeletons.
 * A tap ends it early. Reduced motion: a 150 ms cross-fade with the name. Transform + opacity only (Web Animations).
 */

export type Moment = { card: SpaceCard; from: DOMRect | null; ready: Promise<boolean> };
const EVENT = "nexus:space-moment";
export function startMoment(m: Moment) {
  window.dispatchEvent(new CustomEvent<Moment>(EVENT, { detail: m }));
}

const TILE = 96;
const MIN_MS = 820;
const HOLD_MS = 3000;
const EASE = EASE_OUT;

export function SwitchMoment() {
  const [m, setM] = useState<Moment | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const h = (e: Event) => {
      setM((e as CustomEvent<Moment>).detail);
      setN((k) => k + 1);
    };
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);
  if (!m) return null;
  return <Run key={n} m={m} onEnd={() => setM(null)} />;
}

function Run({ m, onEnd }: { m: Moment; onEnd: () => void }) {
  const s = useStore();
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const wash = useRef<HTMLDivElement>(null);
  const tile = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [holding, setHolding] = useState(false);
  const ended = useRef(false);
  const { setSwitching } = s;

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.getAttribute("data-motion") === "reduce";
    const anims: Animation[] = [];
    const go = (el: Element | null, k: Keyframe[], o: KeyframeAnimationOptions) => {
      if (!el) return;
      const a = el.animate(k, { fill: "both", ...o });
      anims.push(a);
    };
    const t0 = performance.now();
    let ready = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const leave = () => {
      if (ended.current) return;
      ended.current = true;
      const out = root.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduce ? 150 : 240, easing: "ease-out", fill: "forwards" });
      if (out) out.onfinish = onEnd;
      else onEnd();
    };
    if (reduce) {
      go(root.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "linear" });
    } else {
      // The tile: from the switcher's tile box to the centre (FLIP: start transform = source box, end = none).
      const el = tile.current;
      if (el && m.from && m.from.width > 0) {
        const r = el.getBoundingClientRect();
        const dx = m.from.left + m.from.width / 2 - (r.left + r.width / 2);
        const dy = m.from.top + m.from.height / 2 - (r.top + r.height / 2);
        go(el, [{ transform: `translate(${dx}px, ${dy}px) scale(${m.from.width / TILE})` }, { transform: "translate(0,0) scale(1.06)", offset: 0.7 }, { transform: "none" }], { duration: 560, easing: EASE });
      } else go(el, [{ transform: "scale(.6)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, easing: EASE });
      go(wash.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
      go(text.current, [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 320, delay: 260, easing: EASE });
    }
    const minMs = reduce ? 150 : MIN_MS;
    void m.ready.then(() => {
      ready = true;
      setSwitching(false);
      const left = minMs - (performance.now() - t0);
      if (left <= 0) leave();
      else timer = setTimeout(leave, left);
    });
    const hold = setTimeout(() => !ready && setHolding(true), minMs);
    const give = setTimeout(() => {
      if (ready) return;
      // Still loading after 3 s: Home shows its skeletons until the data lands.
      setSwitching(true);
      leave();
    }, HOLD_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(hold);
      clearTimeout(give);
      anims.forEach((a) => a.cancel());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skip = () => {
    if (ended.current) return;
    ended.current = true;
    void m.ready.then(() => setSwitching(false));
    setSwitching(true);
    onEnd();
  };

  const c = m.card;
  return (
    <div
      ref={root}
      role="status"
      aria-live="polite"
      onPointerDown={skip}
      style={{ position: "fixed", inset: 0, zIndex: 70, display: "grid", placeItems: "center", cursor: "pointer", contain: "strict" }}
      data-space-moment={c.id}
    >
      <div ref={wash} aria-hidden style={{ position: "absolute", inset: 0, background: `radial-gradient(120% 90% at 50% 40%, ${deepOf(c.color)}f2, ${deepOf(c.color)} 70%), ${gradientOf(c.color)}`, willChange: "opacity" }} />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 18, color: "#fff", textAlign: "center", padding: 24 }}>
        <div ref={tile} style={{ willChange: "transform", borderRadius: 24, boxShadow: "0 18px 50px -12px rgba(0,0,0,.45), 0 0 0 3px rgba(255,255,255,.85)" }}>
          <SpaceTile name={c.name} color={c.color} icon={c.icon} photo={c.photo} size={TILE} style={{ borderRadius: 24 }} />
        </div>
        <div ref={text} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, willChange: "transform, opacity" }}>
          <span style={{ fontSize: 14, opacity: 0.85, fontWeight: 500 }}>{t.sx.nowIn}</span>
          <b style={{ fontSize: 28, letterSpacing: "-.02em", lineHeight: 1.15, maxWidth: "min(80vw, 520px)", overflowWrap: "anywhere" }} data-moment-name>
            {c.name}
          </b>
          {c.kind === "shared" && c.faces.length > 0 && <Facepile people={c.faces} size={30} max={5} />}
          <span aria-hidden style={{ width: 120, height: 3, borderRadius: 3, overflow: "hidden", background: "rgba(255,255,255,.25)", opacity: holding ? 1 : 0, transition: "opacity .2s" }}>
            <i className="moment-progress" style={{ display: "block", height: "100%", width: "40%", borderRadius: 3, background: "#fff" }} />
          </span>
        </div>
      </div>
    </div>
  );
}
