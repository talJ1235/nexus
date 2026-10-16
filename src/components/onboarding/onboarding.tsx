"use client";

import "../auth/nx.css";
import "../app/settings/nx16.css";
import "../admin/nx17.css";
import "../admin/admin.css";
import "./onboarding.css";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { finishOnboarding, onboardingInvite, saveOnboarding } from "@/app/onboarding-actions";
import { useBeat } from "@/components/app/presence-beat";
import { InviteQr } from "@/components/app/spaces/qr";
import { useI18n } from "@/components/providers";
import { countsFor, DIETS, FREQ, MODES, monogram, people, presetFor, QUICK_STEPS, smShareStart, STORES, type Onboarding, type Who, type Why } from "@/lib/onboarding";
import { CHAINS } from "@/lib/grocery/chains";
import type { ScreenKey } from "@/lib/presence-keys";
import { notifyAsk } from "@/app/notify-actions";
import { useDevice } from "@/components/ui/use-device";

// R17 H1–H4 — onboarding, direction A (boards Onboarding-phone / -desktop): one question per screen, the picture above
// (phone) / beside (desktop) reacts to the answer. Steps 1 why · 2 stores · 3 budget · 4 who · 5 install ·
// 6 notifications · 7 done; six progress segments; Back (hidden on 1 and 7), Skip = out to Home (1–6), one large primary,
// "Not now" on 5 and 6. Skips: joined through a space invite → 4; installed already, or a browser that can't install
// (and isn't an iPhone) → 5; iPhone not on the Home Screen, or no Notification API → 6. Each answer is saved as it's
// given (reload resumes); finishing or skipping out → Home with the "Try it" hint.

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let deferred: InstallEvent | null = null;
const installListeners = new Set<() => void>();
if (typeof window !== "undefined")
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    for (const l of installListeners) l();
  });

const PATH = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  super: "M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 2-1.6L21 7H6 M9 21h.01 M18 21h.01",
  proj: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z",
  price: "M3 17l6-6 4 4 8-8 M14 7h7v7",
  me: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
  partner: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  logo: "M12 2 3 7v10l9 5 9-5V7z M3 7l9 5 9-5 M12 12v10",
  check: "M20 6 9 17l-5-5",
  back: "m15 18-6-6 6-6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3",
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
};
const WHY_TILES: Record<Why, { g: string; pos: React.CSSProperties; icon: number }> = {
  home: { g: "gr-amber", pos: { left: 18, top: 40, width: 70, height: 70 }, icon: 34 },
  super: { g: "gr-green", pos: { left: 98, top: 6, width: 80, height: 80 }, icon: 40 },
  proj: { g: "gr-blue", pos: { left: 110, top: 94, width: 56, height: 56 }, icon: 28 },
  price: { g: "gr-rose", pos: { left: 188, top: 44, width: 64, height: 64 }, icon: 30 },
};
const SYM: Record<Onboarding["currency"], string> = { ILS: "₪", USD: "$", EUR: "€" };
const CONF = ["#f59e0b", "#22936c", "#3172d4", "#c94673", "#7c5ad9"];

const noop = () => () => {};
/** The install prompt is used once. */
const clearDeferred = () => {
  deferred = null;
};

/** `quick` (R18 S5 F1): only steps 2, 4, 5, 6 — the Home card for people who finished onboarding before S5. */
export function OnboardingFlow({ initial, joined, name, quick = false }: { initial: Onboarding; joined: boolean; name: string; quick?: boolean }) {
  const { t, f, locale } = useI18n();
  const O = t.ob;
  const he = locale === "he";
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const desk = useDevice() === "computer";
  const env = useMemo(() => {
    if (typeof window === "undefined") return { iphone: false, standalone: false, notif: true };
    const ua = navigator.userAgent;
    return {
      iphone: /iPhone|iPod/.test(ua) || (/iPad/.test(ua) && !/CriOS|FxiOS/.test(ua)),
      standalone: window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true,
      notif: "Notification" in window,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the device doesn't change; recomputed once hydrated
  }, [hydrated]);
  const canInstall = useSyncExternalStore(
    (cb) => (installListeners.add(cb), () => void installListeners.delete(cb)),
    () => !!deferred,
    () => false,
  );

  const [o, setO] = useState<Onboarding>(initial);
  // ---- R18 S5 F2: the household (counts start from "who you shop for"; the counts say who it is).
  const base = countsFor(o.who);
  const home5 = { adults: o.adults ?? base.adults, kids: o.kids ?? base.kids, babies: o.babies ?? 0, pets: o.pets ?? 0 };
  const peopleN = people({ who: o.who, ...home5 });
  const setWho = (w: Who) => setO((c) => ({ ...c, who: w, ...countsFor(w), babies: c.babies ?? 0 }));
  const setCount = (k: keyof typeof home5, d: number) =>
    setO((c) => {
      const cur = { adults: c.adults ?? countsFor(c.who).adults, kids: c.kids ?? countsFor(c.who).kids, babies: c.babies ?? 0, pets: c.pets ?? 0 };
      const next = { ...cur, [k]: Math.max(k === "adults" ? 1 : 0, Math.min(12, cur[k] + d)) };
      const who: Who = next.kids + next.babies > 0 || next.adults > 2 ? "family" : next.adults === 2 ? "partner" : "me";
      return { ...c, ...next, who };
    });
  // ---- F5: the supermarket's part of the budget (a starting point from the home's size until it's moved).
  const [otherDay, setOtherDay] = useState(() => ![1, 10, 15].includes(initial.startDay ?? 1));
  const skipped0 = useCallback(
    // R17 S5 S4: a computer always sees step 5 — when it can't install (installed already, or no install in this browser)
    // it shows only the phone's QR.
    (i: number) => (i === 1 && joined) || (i === 6 && !desk && (env.standalone || (!env.iphone && !canInstall && !o.installed))) || (i === 7 && ((env.iphone && !env.standalone) || !env.notif)),
    [joined, env, canInstall, o.installed, desk],
  );
  // Quick (F1): only the household, habits, food and budget steps.
  const skipped = useCallback((i: number) => (quick ? !(QUICK_STEPS as readonly number[]).includes(i + 1) : skipped0(i)), [quick, skipped0]);
  const [at, setIdx] = useState(() => Math.min(8, Math.max(0, initial.step - 1)));
  const [dirn, setDirn] = useState<"f" | "b">("f");
  // A resumed step that has to be skipped on this device shows the next one.
  let idx = at;
  while (hydrated && idx < 8 && skipped(idx)) idx++;
  useBeat(hydrated ? (`onboarding-${idx + 1}` as ScreenKey) : null);

  // The answers on screen are the truth; saves go out one after another (the server merges each into the stored
  // answers, so two in flight could undo each other) and their answers never overwrite what's been picked since.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const save = (patch: Parameters<typeof saveOnboarding>[0]) => {
    setO((c) => ({ ...c, ...patch }) as Onboarding);
    queue.current = queue.current.then(() => saveOnboarding(patch)).catch(() => toast.error(t.errors.generic));
    return queue.current;
  };
  const nextIdx = (from: number) => {
    let i = from + 1;
    while (i < 8 && skipped(i)) i++;
    return i;
  };
  const prevIdx = (from: number) => {
    let i = from - 1;
    while (i > 0 && skipped(i)) i--;
    return Math.max(0, i);
  };
  // ---- step 2 (R18 S2 F2): supermarket chains (multi, the first = main) → the main chain's branch
  const smStep = o.why.length === 0 || o.why.includes("super") || o.why.includes("home");
  const [phase, setPhase] = useState<"stores" | "chains" | "branch">("stores");
  const setPhaseDir = (p: "stores" | "chains" | "branch", d: "f" | "b") => {
    setDirn(d);
    setPhase(p);
  };
  const [chains, setChains] = useState<string[]>(() => initial.chains ?? []);
  const toggleChain = (id: string) => setChains((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const [branchQ, setBranchQ] = useState(initial.branch ?? "");
  const [several, setSeveral] = useState(!!initial.several);
  const mainChain = CHAINS.find((c) => c.id === chains[0]) ?? null;
  const chainMono = (c: (typeof CHAINS)[number]) => {
    const st = STORES.find((x) => x.id === c.id);
    return st ? (he ? st.monoHe : st.mono) : monogram(he ? c.he : c.en);
  };
  const chainFan = chains
    .map((id) => CHAINS.find((c) => c.id === id))
    .filter((c): c is (typeof CHAINS)[number] => !!c)
    .slice(0, 5)
    .map((c) => ({ m: chainMono(c), c: c.color }));

  const answers = (i: number): Parameters<typeof saveOnboarding>[0] =>
    i === 0
      ? { why: o.why }
      : i === 2
        ? { stores: o.stores, custom: o.custom, ...(phase !== "stores" ? { chains, branch: several ? null : branchQ.trim() || null, several } : {}) }
        : i === 5
          ? { budget: o.budget ?? 2500, currency: o.currency, smShare: o.smShare ?? null, startDay: o.startDay ?? 1, learnBudget: !!o.learnBudget }
          : i === 1
            ? { who: o.who, adults: home5.adults, kids: home5.kids, babies: home5.babies, pets: home5.pets }
            : i === 3
              ? { freq: o.freq ?? null, days: o.days ?? [], mode: o.mode ?? null }
              : i === 4
                ? { diet: o.diet ?? [], shabbat: !!o.shabbat }
                : {};
  const go = (to: number, d: "f" | "b") => {
    setDirn(d);
    setIdx(to);
  };
  const next = async () => {
    // R18 S2 F2: step 2 goes on to the supermarket's chains, then the main chain's branch (when the person shops for the
    // home or the supermarket), before the budget.
    if (idx === 2 && smStep && phase === "stores") {
      void save({ stores: o.stores, custom: o.custom });
      // Supermarkets picked among the stores start the chain list (the first one = main).
      setChains((c) => (c.length ? c : o.stores.filter((x) => CHAINS.some((ch) => ch.id === x))));
      return setPhaseDir("chains", "f");
    }
    if (idx === 2 && phase === "chains" && chains.length) {
      void save({ chains });
      return setPhaseDir("branch", "f");
    }
    const to = nextIdx(idx);
    if (idx === 1 && o.who && o.who !== "me" && !o.sharedSpaceId) {
      await queue.current;
      await onboardingInvite(he ? "he" : "en", false).then((r) => setO((c) => ({ ...c, sharedSpaceId: r.spaceId })), () => toast.error(t.errors.generic));
    }
    // Quick questions: answers only (no step — the onboarding stays finished); after the budget, back to Home.
    if (quick) {
      void save(answers(idx));
      if (to >= 6) return void leave(false);
      return go(to, "f");
    }
    void save({ ...answers(idx), step: to + 1 });
    go(to, "f");
  };
  const back = () => {
    if (idx === 2 && phase !== "stores") return setPhaseDir(phase === "branch" ? "chains" : "stores", "b");
    const to = prevIdx(idx);
    if (!quick) void save({ step: to + 1 });
    go(to, "b");
  };
  const leave = async (skip: boolean) => {
    await queue.current;
    // Quick questions: back to Home, the card answered (or put away) — the onboarding itself stays as it was.
    if (quick) {
      await saveOnboarding({ quick: skip ? "dismissed" : "done" }).catch(() => {});
      return window.location.assign("/");
    }
    await finishOnboarding(skip).catch(() => {});
    window.location.assign("/?hint=try");
  };

  // ---- step 2: stores
  const [q, setQ] = useState("");
  const picked = new Set(o.stores);
  const toggleStore = (id: string) => setO((c) => ({ ...c, stores: picked.has(id) ? c.stores.filter((x) => x !== id) : [...c.stores, id] }));
  const shownStores = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (n) return STORES.filter((s) => s.en.toLowerCase().includes(n) || s.he.includes(q.trim()) || s.id.includes(n)).slice(0, 12);
    return [...STORES.slice(0, 8), ...STORES.slice(8).filter((s) => picked.has(s.id))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, o.stores]);
  const addCustom = () => {
    const v = q.trim().slice(0, 40);
    if (!v) return;
    setO((c) => ({ ...c, custom: [...new Set([...c.custom, v])].slice(0, 20), stores: [...new Set([...c.stores, `custom:${v}`])] }));
    setQ("");
  };
  const fanList = [...STORES.filter((s) => picked.has(s.id)).map((s) => ({ m: he ? s.monoHe : s.mono, c: s.color })), ...o.custom.filter((c) => picked.has(`custom:${c}`)).map((c, k) => ({ m: monogram(c), c: `m${(k % 9) + 1}` }))].slice(0, 5);
  const storeCount = o.stores.length;

  // ---- step 6: budget
  const budget = o.budget ?? 2500;
  const smAmount = o.smShare ?? Math.round((budget * smShareStart(peopleN)) / 50) * 50;
  const smPct = budget > 0 ? Math.round((Math.min(smAmount, budget) / budget) * 100) : 0;
  const cur = SYM[o.currency];
  const fmt = (v: number) => new Intl.NumberFormat("en-US").format(v);
  const setBudget = (v: number) => setO((c) => ({ ...c, budget: Math.max(0, Math.min(1_000_000, Math.round(v))) }));

  // ---- step 4: who
  const invite = async () => {
    try {
      await queue.current;
      const r = await onboardingInvite(he ? "he" : "en", true);
      setO((c) => ({ ...c, sharedSpaceId: r.spaceId }));
      if (!r.url) return;
      if (!desk) window.open(`https://wa.me/?text=${encodeURIComponent(f(O.inviteText, { url: r.url }))}`, "_blank", "noopener");
      else await navigator.clipboard?.writeText(r.url).then(() => toast.success(O.linkCopied), () => {});
    } catch {
      toast.error(t.errors.generic);
    }
  };

  // ---- step 5: install
  const install = async () => {
    const e = deferred;
    if (!e) return void next();
    await e.prompt();
    const r = await e.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    clearDeferred();
    if (r.outcome === "accepted") {
      setO((c) => ({ ...c, installed: true }));
      void save({ installed: true });
    }
  };

  // ---- step 6: notifications (the permission prompt only on that tap)
  const notify = async () => {
    const res = await Notification.requestPermission().catch(() => "default" as const);
    void save({ notif: res });
    // R17 S3 L1: granted → no reminder cards later (this device subscribes when the app starts).
    if (res === "granted") void notifyAsk("yes").catch(() => {});
  };
  // R17 S3 L1: "Not now" on the notifications step is the first "no" (the reminder card comes back after 3 days).
  const later_ = () => {
    if (idx === 7) void notifyAsk("no").catch(() => {});
    void next();
  };

  // ---- the step's texts and the primary button
  const titleKey = (["why", "home", "stores", "habits", "food", "budget", "install", "notif", "done"] as const)[idx];
  const phoneOnly = desk && !env.iphone && (env.standalone || (!canInstall && !o.installed));
  const smTitle = idx === 2 && phase === "chains" ? O.titles.chains : idx === 2 && phase === "branch" ? f(O.titles.branch, { chain: mainChain ? (he ? mainChain.he : mainChain.en) : "" }) : null;
  const smLine = idx === 2 && phase === "chains" ? O.lines.chains : idx === 2 && phase === "branch" ? O.lines.branch : null;
  const title = smTitle ?? (idx === 6 ? (env.iphone ? O.titles.installIphone : phoneOnly ? O.titles.installPhone : desk ? O.titles.installDesk : O.titles.install) : idx === 8 ? f(O.titles.done, { name }) : O.titles[titleKey]);
  const line = smLine ?? (idx === 6 ? (env.iphone ? O.lines.installIphone : phoneOnly ? O.lines.installPhone : desk ? O.lines.installDesk : O.lines.install) : idx === 2 ? f(O.lines.stores, { n: storeCount }) : O.lines[titleKey]);
  let cta = O.continue;
  let primary: () => void = () => void next();
  let later = false;
  if (idx === 6) {
    if (env.iphone) cta = O.added;
    else if (!o.installed && canInstall) {
      cta = O.install;
      primary = () => void install();
      later = true;
    }
  }
  if (idx === 7 && o.notif !== "granted" && o.notif !== "denied") {
    cta = O.turnOn;
    primary = () => void notify();
    later = true;
  }
  if (idx === 8) {
    cta = O.goHome;
    primary = () => void leave(false);
  }
  const showBack = quick ? idx > 1 : idx > 0 && idx < 8;
  const showSkip = idx < 8;

  // Desktop: Enter = the primary (not while typing a store name).
  useEffect(() => {
    if (!desk) return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented || (e.target as HTMLElement)?.closest?.("button, a, [data-store-search]")) return;
      e.preventDefault();
      primary();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  if (!hydrated) return <div className="nx ob" aria-busy="true" />;

  const enter = dirn === "b" ? "enter-b" : "enter-f";
  // Progress: 8 segments (the done screen has none); the quick questions show their own 4.
  const segN = quick ? QUICK_STEPS.length : 8;
  const segAt = quick ? Math.max(0, (QUICK_STEPS as readonly number[]).indexOf(idx + 1)) : Math.min(7, idx);
  // R18 S5: under the primary on the steps that set something.
  const later5 = idx >= 1 && idx <= 5 ? <p className="tiny" style={{ textAlign: "center", margin: "8px 0 0" }} data-ob-later-note>{O.changeLater}</p> : null;
  const segs = (
    <div className="prog" style={desk ? { maxWidth: 320 } : { padding: "0 6px" }} role="progressbar" aria-valuemin={1} aria-valuemax={segN} aria-valuenow={segAt + 1} aria-label={f(O.stepOf, { n: segAt + 1 })}>
      {Array.from({ length: segN }, (_, i) => (
        <i key={i} className={i <= segAt ? "on" : ""} />
      ))}
    </div>
  );
  const ico = (d: string, size = 24) => (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={{ width: size, height: size }}>
      <path d={d} />
    </svg>
  );

  // ---- the pictures (H3)
  const shared = o.who && o.who !== "me";
  const scene = (
    <div key={`scene-${idx}`} className="scene-wrap" data-ob-scene={idx + 1}>
      {idx === 0 && (
        <div className="scene">
          {(Object.keys(WHY_TILES) as Why[]).map((w) => (
            <span key={w} className={`fl ${WHY_TILES[w].g}${o.why.includes(w) ? "" : " off"}`} style={WHY_TILES[w].pos}>
              <svg viewBox="0 0 24 24" style={{ width: WHY_TILES[w].icon, height: WHY_TILES[w].icon }} aria-hidden="true">
                <path d={PATH[w]} />
              </svg>
            </span>
          ))}
        </div>
      )}
      {idx === 2 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 150, width: 260 }}>
          {(phase === "stores" ? fanList : chainFan).map((s, i, arr) => {
            const k = i - (arr.length - 1) / 2;
            return (
              <span key={`${s.m}${i}`} className={`mono-t pop ${s.c}`} style={{ width: 72, height: 72, borderRadius: 20, fontSize: 24, marginInlineStart: i ? -18 : 0, transform: `rotate(${k * 7}deg) translateY(${Math.abs(k) * 6}px)`, boxShadow: "0 12px 26px -12px rgba(0,0,0,.5),0 0 0 3px var(--screen)", animationDelay: `${i * 40}ms` }}>
                {s.m}
              </span>
            );
          })}
          {(phase === "stores" ? fanList : chainFan).length === 0 && (
            <span className="mono-t" style={{ width: 72, height: 72, borderRadius: 20, background: "var(--s3)", color: "var(--faint)", fontSize: 28 }}>
              ?
            </span>
          )}
        </div>
      )}
      {idx === 1 && (
        // R18 S5 F2: the household as figures — adults, kids, babies, pets — added as they're counted.
        <div className="ob5-scene" data-ob-home-scene>
          <span className="ob5-cap">
            {peopleN === 1 ? O.home5.person : f(O.home5.people, { n: peopleN })}
            {home5.pets ? ` · ${home5.pets === 1 ? O.home5.petOne : f(O.home5.petN, { n: home5.pets })}` : ""}
          </span>
          <div className="ob5-figs">
            {[
              ...Array.from({ length: Math.min(4, home5.adults) }, (_, k) => ["a", k] as const),
              ...Array.from({ length: Math.min(4, home5.kids) }, (_, k) => ["k", k] as const),
              ...Array.from({ length: Math.min(3, home5.babies) }, (_, k) => ["b", k] as const),
              ...Array.from({ length: Math.min(3, home5.pets) }, (_, k) => ["p", k] as const),
            ].map(([t, k]) => (
              <span key={`${t}${k}`} className={`ob5-fig ob5-${t} pop`}>
                <i />
                <b />
              </span>
            ))}
          </div>
        </div>
      )}
      {idx === 3 && (
        // F3: the week, the usual days lit; "ready the evening before".
        <div className="ob5-scene" data-ob-habits-scene>
          <div className="ob5-week">
            {O.habits.wd.map((d, k) => (
              <span key={k} className={`ob5-day${(o.days ?? []).includes(k) ? " on" : ""}`}>
                {d}
              </span>
            ))}
          </div>
          <span className="ob5-note">{(o.days ?? []).length ? f(O.habits.ready, { day: O.habits.wd[(o.days ?? [])[0]] }) : O.habits.readyNone}</span>
        </div>
      )}
      {idx === 4 && (
        // F4: a plate with the choices on it.
        <div className="ob5-scene" data-ob-food-scene>
          <div className="ob5-plate">
            <div className="ob5-plate-in">
              {[...(o.diet ?? []).map((d) => O.food[d]), ...(o.shabbat ? [O.food.shabbat.split(" ")[0]] : [])].slice(0, 4).map((x) => (
                <span key={x} className="ob5-tag pop">
                  {x}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      {idx === 5 && (
        // F5: the supermarket's part of the household budget.
        <div className="ob5-scene" data-ob-budget-scene>
          <div className="ob5-donut" style={{ ["--p" as string]: `${smPct}%` }}>
            <b className="num">{o.learnBudget ? "?" : `${smPct}%`}</b>
          </div>
          <div className="ob5-legend">
            <span>
              <i style={{ background: "#2f9a58" }} />
              {O.bud5.smPart}
            </span>
            <span>
              <i style={{ background: "var(--s3)" }} />
              {O.bud5.rest}
            </span>
          </div>
        </div>
      )}
      {idx === 6 &&
        (desk ? (
          <div style={{ width: 190, height: 120, borderRadius: 12, border: "2.5px solid var(--ink2)", background: "var(--raised)", boxShadow: "var(--sh2)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ height: 18, borderBottom: "1.5px solid var(--line)", display: "flex", gap: 4, alignItems: "center", padding: "0 8px" }}>
              <i style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--line-strong)" }} />
              <i style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--line-strong)" }} />
            </div>
            <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
              {o.installed ? (
                <span className="appicon pop" style={{ width: 44, height: 44, borderRadius: 12 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" style={{ width: 24, height: 24 }} aria-hidden="true">
                    <path d={PATH.logo} />
                  </svg>
                </span>
              ) : (
                <i style={{ width: 44, height: 44, borderRadius: 12, border: "1.5px dashed var(--ink2)" }} />
              )}
            </div>
          </div>
        ) : (
          <div style={{ width: 96, height: 150, borderRadius: 22, border: "2.5px solid var(--ink2)", background: "var(--raised)", display: "grid", gridTemplateColumns: "repeat(3,22px)", gap: 8, alignContent: "start", justifyContent: "center", padding: "22px 0 0", boxShadow: "var(--sh2)" }}>
            {[0, 1, 2, 3].map((k) => (
              <i key={k} style={{ width: 22, height: 22, borderRadius: 6, background: "var(--s3)" }} />
            ))}
            {o.installed || env.iphone ? (
              <span className="appicon pop" style={{ width: 22, height: 22, borderRadius: 6, boxShadow: "0 4px 10px -3px rgba(0,0,0,.4)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" style={{ width: 14, height: 14 }} aria-hidden="true">
                  <path d={PATH.logo} />
                </svg>
              </span>
            ) : (
              <i style={{ width: 22, height: 22, borderRadius: 6, border: "1.5px dashed var(--ink2)" }} />
            )}
            <i style={{ width: 22, height: 22, borderRadius: 6, background: "var(--s3)" }} />
          </div>
        ))}
      {idx === 7 && (
        <div style={{ width: desk ? 280 : 310, maxWidth: "88vw", display: "flex", flexDirection: "column", gap: 8 }} className="stg">
          {[
            [O.n1a, O.n1b, O.now],
            [O.n2a, O.n2b, "9:00"],
          ].map(([a, b, w], k) => (
            <div key={k} className="notif" style={k ? { transform: "scale(.96)", opacity: 0.9 } : undefined}>
              <span className="app">
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
                  <path d={PATH.logo} />
                </svg>
              </span>
              <span className="t">
                <b>{a}</b>
                {b}
              </span>
              <span className="when">{w}</span>
            </div>
          ))}
        </div>
      )}
      {idx === 8 && (
        <div className="conf-box">
          <span className="hero-t gr-green pop" style={{ width: 104, height: 104, borderRadius: 30 }}>
            <svg viewBox="0 0 24 24" style={{ width: 52, height: 52 }} aria-hidden="true">
              <path d={PATH.check} />
            </svg>
          </span>
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2;
            const r = 70 + (i % 3) * 14;
            return <i key={i} className="conf" aria-hidden="true" style={{ left: 56, top: 56, background: CONF[i % 5], ["--x" as string]: `${Math.round(Math.cos(a) * r)}px`, ["--y" as string]: `${Math.round(Math.sin(a) * r)}px`, ["--r" as string]: `${i * 47}deg`, animationDelay: `${120 + i * 15}ms` }} />;
          })}
        </div>
      )}
    </div>
  );

  // ---- the answers (H2)
  const whyLabels: Record<Why, [string, string]> = { home: [O.why.home, O.why.homeSub], super: [O.why.super, O.why.superSub], proj: [O.why.proj, O.why.projSub], price: [O.why.price, O.why.priceSub] };
  const presetName = t.hc.presets[presetFor(o.why)];
  const tick = (
    <span className="tick">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={PATH.check} />
      </svg>
    </span>
  );
  const content = (
    <div key={`c-${idx}`} className={enter} data-ob-step={idx + 1}>
      {idx === 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: desk ? 12 : 10 }} role="group" aria-label={title}>
          {(Object.keys(whyLabels) as Why[]).map((w) => {
            const on = o.why.includes(w);
            return (
              <button key={w} type="button" className={`why${on ? " on" : ""}`} aria-pressed={on} onClick={() => setO((c) => ({ ...c, why: on ? c.why.filter((x) => x !== w) : [...c.why, w] }))} data-ob-why={w}>
                <span className="ic">{ico(PATH[w], 20)}</span>
                <b>{whyLabels[w][0]}</b>
                <small>{whyLabels[w][1]}</small>
                {tick}
              </button>
            );
          })}
        </div>
      )}
      {idx === 2 && phase === "chains" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-ob-chains>
          <div className="stores" style={{ gap: desk ? 10 : 8 }}>
            {CHAINS.map((c) => {
              const k = chains.indexOf(c.id);
              return (
                <button key={c.id} type="button" className={`st${k >= 0 ? " on" : ""}`} aria-pressed={k >= 0} onClick={() => toggleChain(c.id)} data-ob-chain={c.id} style={{ position: "relative" }}>
                  <span className={`mono-t ${c.color}`}>{chainMono(c)}</span>
                  <span className="nm" title={he ? c.he : c.en}>
                    {he ? c.he : c.en}
                  </span>
                  {k === 0 ? (
                    <span style={{ position: "absolute", insetInlineEnd: 6, top: 6, background: "var(--ink)", color: "var(--bg)", fontSize: 11, fontWeight: 700, padding: "1px 6px", borderRadius: 6 }} data-ob-main>
                      {O.sm.main}
                    </span>
                  ) : (
                    tick
                  )}
                </button>
              );
            })}
          </div>
          <p className="tiny" style={{ margin: "2px 2px 0" }}>
            {O.sm.firstMain}
          </p>
        </div>
      )}
      {idx === 2 && phase === "branch" && mainChain && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-ob-branch>
          <label className="input">
            {ico(PATH.search, 18)}
            <input placeholder={O.sm.branchPh} aria-label={O.sm.branchPh} value={branchQ} maxLength={120} disabled={several} onChange={(e) => setBranchQ(e.target.value)} data-store-search data-ob-branch-input />
          </label>
          <div className="card" style={{ padding: 0, overflow: "hidden", opacity: several ? 0.5 : 1 }}>
            <div className="li" data-ob-branch-row>
              <span className={`mono-t ${mainChain.color}`} style={{ width: 36, height: 36, borderRadius: 10, fontSize: 13 }}>
                {chainMono(mainChain)}
              </span>
              <span className="grow bidi">
                <b>{branchQ.trim() ? f(O.sm.branchRow, { chain: he ? mainChain.he : mainChain.en, branch: branchQ.trim() }) : f(O.sm.branchAny, { chain: he ? mainChain.he : mainChain.en })}</b>
              </span>
            </div>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div className="li">
              <span className="grow">
                <b>{O.sm.several}</b>
                <br />
                <span className="tiny">{O.sm.severalSub}</span>
              </span>
              <button type="button" role="switch" aria-checked={several} aria-label={O.sm.several} className={`tgl${several ? " on" : ""}`} onClick={() => setSeveral(!several)} data-ob-several />
            </div>
          </div>
        </div>
      )}
      {idx === 2 && phase === "stores" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="input">
            {ico(PATH.search, 18)}
            <input
              placeholder={O.search}
              aria-label={O.search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (shownStores.length === 1) toggleStore(shownStores[0].id);
                  else if (!shownStores.length) addCustom();
                }
              }}
              data-store-search
            />
          </label>
          <div className="stores" style={{ gap: desk ? 10 : 8 }}>
            {shownStores.map((s) => {
              const on = picked.has(s.id);
              return (
                <button key={s.id} type="button" className={`st${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggleStore(s.id)} data-ob-store={s.id}>
                  <span className={`mono-t ${s.color}`}>{he ? s.monoHe : s.mono}</span>
                  <span className="nm" title={he ? s.he : s.en}>
                    {he ? s.he : s.en}
                  </span>
                  {tick}
                </button>
              );
            })}
            {o.custom.map((c, k) => {
              const id = `custom:${c}`;
              const on = picked.has(id);
              return (
                <button key={id} type="button" className={`st${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggleStore(id)} data-ob-store={id}>
                  <span className={`mono-t m${(k % 9) + 1}`}>{monogram(c)}</span>
                  <span className="nm" title={c}>
                    {c}
                  </span>
                  {tick}
                </button>
              );
            })}
          </div>
          {q.trim() && !STORES.some((s) => s.en.toLowerCase() === q.trim().toLowerCase() || s.he === q.trim()) && (
            <button type="button" className="chipb" style={{ alignSelf: "flex-start", height: 40 }} onClick={addCustom} data-ob-add-store>
              {ico(PATH.plus, 15)}
              {f(O.addStore, { name: q.trim().slice(0, 40) })}
            </button>
          )}
        </div>
      )}
      {idx === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-ob-home>
          <div className="seg" role="radiogroup" aria-label={title} style={{ width: "100%" }}>
            {(["me", "partner", "family"] as const).map((w) => (
              <button key={w} type="button" role="radio" aria-checked={o.who === w} className={o.who === w ? "on" : ""} style={{ flex: 1, justifyContent: "center", height: 40 }} onClick={() => setWho(w)} data-ob-who={w}>
                {w === "me" ? O.home5.just : w === "partner" ? O.home5.couple : O.home5.family}
              </button>
            ))}
          </div>
          <div className="card" style={{ padding: 0 }}>
            {(
              [
                ["adults", O.home5.adults, O.home5.adultsSub, 1],
                ["kids", O.home5.kids, O.home5.kidsSub, 0],
                ["babies", O.home5.babies, O.home5.babiesSub, 0],
                ["pets", O.home5.pets, O.home5.petsSub, 0],
              ] as const
            ).map(([k, label, sub, min]) => (
              <div key={k} className="li" style={{ minHeight: 56 }} data-ob-count={k}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <b>{label}</b>
                  <br />
                  <span className="tiny">{sub}</span>
                </span>
                <button type="button" className="btn icon" style={{ width: 40, height: 40, borderRadius: 20 }} onClick={() => setCount(k, -1)} disabled={home5[k] <= min} aria-label={f(O.home5.less, { what: label })} data-ob-count-less={k}>
                  {ico(PATH.minus, 18)}
                </button>
                <b className="num" style={{ minWidth: 26, textAlign: "center", fontSize: 18 }} data-ob-count-n={k}>
                  {home5[k]}
                </b>
                <button type="button" className="btn icon" style={{ width: 40, height: 40, borderRadius: 20 }} onClick={() => setCount(k, 1)} disabled={home5[k] >= 12} aria-label={f(O.home5.more, { what: label })} data-ob-count-more={k}>
                  {ico(PATH.plus, 18)}
                </button>
              </div>
            ))}
          </div>
          {shared && (
            <div className="card rise" style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }} data-ob-shared>
              <span className="tile t40 gr-green">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={PATH.home} />
                </svg>
              </span>
              <span style={{ flex: 1, lineHeight: 1.3, minWidth: 0 }}>
                <b>{O.home}</b>
                <br />
                <span className="tiny">{O.sharedLine}</span>
              </span>
              <button type="button" className="btn sm" style={{ height: 40 }} onClick={() => void invite()} data-ob-invite>
                {desk ? O.copyLink : O.invite}
              </button>
            </div>
          )}
        </div>
      )}
      {idx === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-ob-habits>
          <div>
            <p className="ob5-q">{O.habits.often}</p>
            <div className="ob5-chips" role="radiogroup" aria-label={O.habits.often}>
              {FREQ.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={o.freq === k} className={`chipb${o.freq === k ? " on" : ""}`} onClick={() => setO((c) => ({ ...c, freq: k }))} data-ob-freq={k}>
                  {O.habits[k]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="ob5-q">{O.habits.days}</p>
            <div className="ob5-days" role="group" aria-label={O.habits.days}>
              {O.habits.wd.map((d, k) => {
                const on = (o.days ?? []).includes(k);
                return (
                  <button key={k} type="button" aria-pressed={on} className={`chipb ob5-dayb${on ? " on" : ""}`} onClick={() => setO((c) => ({ ...c, days: on ? (c.days ?? []).filter((x) => x !== k) : [...(c.days ?? []), k].sort() }))} data-ob-day={k}>
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="ob5-q">{O.habits.how}</p>
            <div className="ob5-chips" role="radiogroup" aria-label={O.habits.how}>
              {MODES.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={o.mode === k} className={`chipb${o.mode === k ? " on" : ""}`} onClick={() => setO((c) => ({ ...c, mode: k }))} data-ob-mode={k}>
                  {O.habits[k]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {idx === 4 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-ob-food>
          <div className="ob5-chips" role="group" aria-label={title}>
            {DIETS.map((k) => {
              const on = (o.diet ?? []).includes(k);
              return (
                <button key={k} type="button" aria-pressed={on} className={`chipb${on ? " on" : ""}`} onClick={() => setO((c) => ({ ...c, diet: on ? (c.diet ?? []).filter((x) => x !== k) : [...(c.diet ?? []), k] }))} data-ob-diet={k}>
                  {O.food[k]}
                </button>
              );
            })}
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div className="li" style={{ minHeight: 64 }}>
              <span className="grow" style={{ minWidth: 0 }}>
                <b>{O.food.shabbat}</b>
                <br />
                <span className="tiny">{O.food.shabbatSub}</span>
              </span>
              <button type="button" role="switch" aria-checked={!!o.shabbat} aria-label={O.food.shabbat} className={`tgl${o.shabbat ? " on" : ""}`} onClick={() => setO((c) => ({ ...c, shabbat: !c.shabbat }))} data-ob-shabbat />
            </div>
          </div>
        </div>
      )}
      {idx === 5 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, opacity: o.learnBudget ? 0.55 : 1 }} data-ob-budget5>
          <label className="input" style={{ height: 58 }}>
            <span className="sub" style={{ flex: 1 }}>{O.bud5.household}</span>
            <button type="button" className="chipb" style={{ height: 34, minWidth: 40 }} onClick={() => setO((x) => ({ ...x, currency: x.currency === "ILS" ? "USD" : x.currency === "USD" ? "EUR" : "ILS" }))} aria-label={o.currency} data-ob-cur={o.currency}>
              {cur}
            </button>
            <input value={fmt(budget)} inputMode="decimal" aria-label={O.budgetLabel} style={{ fontSize: 22, fontWeight: 800, width: 120, textAlign: "end" }} dir="ltr" disabled={!!o.learnBudget} onChange={(e) => setBudget(Number(e.target.value.replace(/[^\d]/g, "")) || 0)} data-ob-budget />
          </label>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <p className="ob5-q" style={{ flex: 1, margin: 0 }}>{O.bud5.sm}</p>
              <b className="num" dir="ltr" data-ob-sm-amount>
                {cur}
                {fmt(smAmount)}
              </b>
            </div>
            <input type="range" min={0} max={Math.max(100, budget)} step={50} value={Math.min(smAmount, Math.max(100, budget))} disabled={!!o.learnBudget} onChange={(e) => setO((x) => ({ ...x, smShare: Number(e.target.value) }))} className="ob5-range" style={{ ["--p" as string]: `${smPct}%` }} aria-label={O.bud5.sm} data-ob-sm-share />
            <p className="tiny" style={{ margin: "4px 0 0" }}>{O.bud5.start}</p>
          </div>
          <div>
            <p className="ob5-q">{O.bud5.monthStarts}</p>
            <div className="ob5-chips" role="radiogroup" aria-label={O.bud5.monthStarts}>
              {[1, 10, 15].map((d) => (
                <button key={d} type="button" role="radio" aria-checked={(o.startDay ?? 1) === d} className={`chipb${(o.startDay ?? 1) === d ? " on" : ""}`} onClick={() => setO((x) => ({ ...x, startDay: d }))} data-ob-start={d}>
                  {d === 1 ? O.bud5.d1 : d === 10 ? O.bud5.d10 : O.bud5.d15}
                </button>
              ))}
              {otherDay ? (
                <label className="input" style={{ height: 40, width: 120 }}>
                  <input inputMode="numeric" value={o.startDay ?? 1} aria-label={O.bud5.other} onChange={(e) => setO((x) => ({ ...x, startDay: Math.max(1, Math.min(28, Number(e.target.value.replace(/[^\d]/g, "")) || 1)) }))} dir="ltr" data-ob-start-other />
                </label>
              ) : (
                <button type="button" className="chipb" onClick={() => setOtherDay(true)} data-ob-start="other">
                  {O.bud5.other}
                </button>
              )}
            </div>
          </div>
          <button type="button" className={`chipb${o.learnBudget ? " on" : ""}`} style={{ alignSelf: "flex-start", height: 40, opacity: 1 }} aria-pressed={!!o.learnBudget} onClick={() => setO((x) => ({ ...x, learnBudget: !x.learnBudget }))} data-ob-learn>
            {o.learnBudget ? O.bud5.learnOn : O.bud5.learn}
          </button>
        </div>
      )}
      {idx === 6 &&
        (env.iphone ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-ob-iphone-guide>
            <div className="card">
              {[O.i1, O.i2, O.i3].map((s, k) => (
                <div key={k} className="inst">
                  <span className="n">{k + 1}</span>
                  <span style={{ flex: 1 }}>{s}</span>
                  {k < 2 ? (
                    <span className="ic" style={{ width: 34, height: 34 }}>
                      {ico(k === 0 ? "M12 3v12 M8 7l4-4 4 4 M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" : "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M12 8v8 M8 12h8", 16)}
                    </span>
                  ) : (
                    <span className="appicon" style={{ width: 34, height: 34, borderRadius: 9 }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" style={{ width: 20, height: 20 }} aria-hidden="true">
                        <path d={PATH.logo} />
                      </svg>
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="hint">{O.iNote}</div>
          </div>
        ) : desk ? (
          <div style={{ display: "grid", gridTemplateColumns: phoneOnly ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)", gap: 12 }} data-ob-install={phoneOnly ? "phone" : "both"}>
            {!phoneOnly && (
            <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              <b>{O.thisPc}</b>
              <span className="sub">{O.thisPcLine}</span>
              {o.installed && (
                <div className="ok-line rise" style={{ marginTop: "auto" }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={PATH.check} />
                  </svg>
                  {O.installedShort}
                </div>
              )}
            </div>
            )}
            <div className="card" style={{ padding: 18, display: "flex", gap: 14, alignItems: "center" }} data-ob-phone-qr>
              <InviteQr value={typeof window === "undefined" ? "" : window.location.origin} name="Nexus" color="slate" size={96} className="qr-box" />
              <span style={{ lineHeight: 1.4, minWidth: 0 }}>
                <b>{O.onPhone}</b>
                <br />
                <span className="sub">{O.onPhoneLine}</span>
              </span>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
              <span className="appicon" style={{ width: 52, height: 52, borderRadius: 14 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round" style={{ width: 28, height: 28 }} aria-hidden="true">
                  <path d={PATH.logo} />
                </svg>
              </span>
              <span style={{ flex: 1, lineHeight: 1.35 }}>
                <b style={{ fontSize: 16 }}>Nexus</b>
                <br />
                <span className="sub">{O.appLine}</span>
              </span>
            </div>
            {o.installed && (
              <div className="ok-line rise">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={PATH.check} />
                </svg>
                {O.installedMsg}
              </div>
            )}
          </div>
        ))}
      {idx === 7 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card" style={{ padding: "4px 0" }}>
            {[
              [O.k1, PATH.partner],
              [O.k2, PATH.price],
              [O.k3, "M1 3h15v13H1z M16 8h4l3 3v5h-7z M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"],
            ].map(([s, d]) => (
              <div key={s} className="sumr">
                <span className="ic" style={{ width: 32, height: 32 }}>
                  {ico(d, 16)}
                </span>
                {s}
              </div>
            ))}
          </div>
          {o.notif === "granted" && (
            <div className="ok-line rise" data-ob-notif="granted">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={PATH.check} />
              </svg>
              {O.notifOnMsg}
            </div>
          )}
          {o.notif === "denied" && (
            <div className="alert warn" data-ob-notif="denied">
              {O.notifDenied}
            </div>
          )}
        </div>
      )}
      {idx === 8 && (
        <div>
          <div className="card stg" style={{ padding: "4px 0" }} data-ob-summary>
            <div className="sumr">
              <span className="ic" style={{ width: 32, height: 32 }}>
                {ico("M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z", 16)}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>{f(O.sumWhy, { preset: presetName })}</span>
            </div>
            <div className="sumr">
              <span className="ic" style={{ width: 32, height: 32 }}>
                {ico("M3 9l1.5-5h15L21 9 M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z M5 13v8h14v-8", 16)}
              </span>
              {f(O.sumStores, { n: storeCount })}
            </div>
            <div className="sumr">
              <span className="ic" style={{ width: 32, height: 32 }}>
                {ico("M3 7a2 2 0 0 1 2-2h13v4 M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z M16 14h.01", 16)}
              </span>
              {o.learnBudget ? O.bud5.learnOn : o.budget ? f(O.sumBudget, { amount: `${cur}${fmt(o.budget)}` }) : O.sumNoBudget}
            </div>
            {/* R18 S5 F1: the home and the shopping habits. */}
            <div className="sumr" data-ob-sum-home>
              <span className="ic" style={{ width: 32, height: 32 }}>
                {ico("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8", 16)}
              </span>
              {peopleN === 1 ? O.home5.person : f(O.home5.people, { n: peopleN })}
              {home5.pets ? ` · ${home5.pets === 1 ? O.home5.petOne : f(O.home5.petN, { n: home5.pets })}` : ""}
            </div>
            {(o.freq || (o.days ?? []).length > 0) && (
              <div className="sumr" data-ob-sum-habits>
                <span className="ic" style={{ width: 32, height: 32 }}>
                  {ico("M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M3 10h18 M8 2v4 M16 2v4", 16)}
                </span>
                {[o.freq ? O.habits[o.freq] : null, (o.days ?? []).map((d) => O.habits.wd[d]).join(" · ") || null].filter(Boolean).join(" — ")}
              </div>
            )}
            <div className="sumr">
              <span className="tile t28 gr-green">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={PATH.home} />
                </svg>
              </span>
              {shared ? O.sumShared : O.sumMe}
            </div>
          </div>
          {desk && (
            <div className="hint" style={{ marginTop: 14 }}>
              {O.tryIt}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const backBtn = (cls: string) => (
    <button type="button" className={cls} onClick={back} aria-label={O.back} data-ob-back>
      <svg className="i sm flip" viewBox="0 0 24 24" aria-hidden="true">
        <path d={PATH.back} />
      </svg>
      {desk && O.back}
    </button>
  );

  if (desk)
    return (
      <div className="nx ob" data-onboarding={idx + 1}>
        <div className="band brandband">
          <span className="logo">
            <svg className="i lg" viewBox="0 0 24 24" aria-hidden="true">
              <path d={PATH.logo} />
            </svg>
            Nexus
          </span>
          <div className="stage">
            <div className="big-scene">{scene}</div>
          </div>
          <div className="tiny" style={{ textAlign: "center" }}>
            {idx < 8 ? f(O.stepOf, { n: idx + 1 }) : ""}
          </div>
        </div>
        <div className="main">
          <div style={{ display: "flex", alignItems: "center", gap: 16, height: 40 }}>
            {segs}
            <span style={{ flex: 1 }} />
            {showSkip && (
              <button type="button" className="btn ghost" onClick={() => void leave(true)} data-ob-skip>
                {O.skip}
              </button>
            )}
          </div>
          <div className="col">
            <h1 className="qt">{title}</h1>
            <p className="ql">{line}</p>
            <div className="content">{content}</div>
            {later5}
            <div className="actions">
              {showBack && backBtn("btn lg")}
              <span style={{ flex: 1 }} />
              {later && (
                <button type="button" className="btn lg ghost" onClick={later_} data-ob-later>
                  {O.notNow}
                </button>
              )}
              <button type="button" className="btn lg pri" style={{ minWidth: 180 }} onClick={primary} data-ob-primary>
                {cta}
                <span className="kbd" style={{ borderColor: "rgba(255,255,255,.3)", color: "inherit", opacity: 0.7 }} aria-hidden="true">
                  Enter
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );

  return (
    <div className="nx ob" data-onboarding={idx + 1}>
      <div className="band brandband">
        <div className="top">
          {showBack ? backBtn("btn icon ghost") : <span style={{ width: 40 }} />}
          {segs}
          {showSkip && (
            <button type="button" className="btn sm ghost" onClick={() => void leave(true)} style={{ minWidth: 56, height: 40 }} data-ob-skip>
              {O.skip}
            </button>
          )}
        </div>
        <div className="stage">{scene}</div>
      </div>
      <div className="hd">
        <h1>{title}</h1>
        <p>{line}</p>
      </div>
      <div className="body">{content}</div>
      <div className="foot">
        <button type="button" className="btn lg pri block" onClick={primary} data-ob-primary>
          {cta}
        </button>
        {later5}
        {later && (
          <button type="button" className="btn lg ghost block" style={{ height: 44 }} onClick={later_} data-ob-later>
            {O.notNow}
          </button>
        )}
      </div>
    </div>
  );
}
