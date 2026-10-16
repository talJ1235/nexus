"use client";

import "../supermarket/sm.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, X } from "lucide-react";
import { useI18n } from "@/components/providers";
import { HoldButton } from "@/components/ui/hold-button";
import { Sheet } from "@/components/ui/overlays";
import { useDevice } from "@/components/ui/use-device";
import {
  forgetLearned,
  undoForgetLearned,
  hiddenProducts,
  smLearned,
  unhideProduct,
} from "@/app/supermarket-actions";
import type { LearnedFact } from "@/lib/db-scoped/grocery";
import { capFor, monthKeyIn } from "@/lib/budget";
import { formatMoney } from "@/lib/money";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { ProductTile, sectionColor } from "../supermarket/art";
import { refreshSmHome, useSmHome } from "../supermarket/data";
import { chainDef, monoColor, storeLabel } from "../supermarket/numbers";
import { SectionOrder, StorePicker } from "../supermarket/store-picker";
import { DEFAULT_ORDER, cleanOrder } from "@/lib/grocery/sections";
import { typeOf } from "@/lib/grocery/classify";
import { I, P, SectionHead } from "./ui";
import type { PageProps } from "./shell";
import { SmHabits } from "./household";

// R18 S2 F1 — Settings → Supermarket (boards Settings-phone / Settings-desktop): only the main store (+ also shop at),
// the section order, the products you hid (Suggest again) and "What Nexus learned". No draft switch, no colours switch, no
// tab-4 setting, no "My answers". What Nexus learned: what you told us (✎ opens the place it changes) and what it learned
// (✕ forgets: the learning drops that fact and learns it again), Forget everything (learning only).

type Hidden = Awaited<ReturnType<typeof hiddenProducts>>[number];

function useHidden() {
  const { locale } = useI18n();
  const [rows, setRows] = useState<Hidden[] | null>(null);
  const load = useCallback(
    () => void hiddenProducts(locale).then(setRows, () => setRows([])),
    [locale],
  );
  useEffect(load, [load]);
  return { rows, setRows };
}

function useLearned() {
  const [facts, setFacts] = useState<LearnedFact[] | null>(null);
  const load = useCallback(
    () => void smLearned().then(setFacts, () => setFacts([])),
    [],
  );
  useEffect(load, [load]);
  return { facts, setFacts, load };
}

function Mono({ chain, size = 40 }: { chain: string; size?: number }) {
  const { locale } = useI18n();
  const def = chainDef(chain);
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[11px] font-extrabold text-white"
      style={{
        width: size,
        height: size,
        background: def ? monoColor(def.color) : "var(--muted)",
        fontSize: size * 0.38,
      }}
      aria-hidden
    >
      {(locale === "he" ? def?.monoHe : def?.mono)?.slice(0, 1) ??
        chain.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** The store chip's name ("Shufersal Deal · Herzl St."). */
function useStoreName() {
  const { locale } = useI18n();
  return (chain: string, branch: string) =>
    storeLabel(chain, branch, locale) ?? chain;
}

// ---------- the Supermarket section ----------

export function SupermarketPage({ go, phone }: PageProps) {
  const s = useStore();
  const { t, f } = useI18n();
  const L = t.sm.set;
  const { home } = useSmHome();
  const ro = s.readOnly;
  const name = useStoreName();
  const [picking, setPicking] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const { rows: hidden, setRows: setHidden } = useHidden();
  const { facts } = useLearned();
  const stores = home?.stores ?? [];
  const main = stores.find((x) => x.isDefault) ?? null;
  const also = stores.filter((x) => !x.isDefault);
  const learnedOrders = stores.filter(
    (x) => x.sectionOrder || x.suggestedOrder,
  ).length;
  const order = main?.sectionOrder
    ? cleanOrder(main.sectionOrder)
    : [...DEFAULT_ORDER];
  const waiting = stores.filter((x) => x.suggestedOrder).length;
  const sheets = (
    <>
      <StorePicker open={picking} onClose={() => setPicking(false)} />
      <SectionOrder
        open={ordering}
        onClose={() => setOrdering(false)}
        onPickStore={() => setPicking(true)}
      />
    </>
  );

  if (phone)
    return (
      <div className="flex flex-col gap-4" data-settings-sm>
        <p className="sub" style={{ margin: "-4px 4px 0" }}>
          {f(L.forSpace, { space: s.space?.name ?? "" })}
        </p>
        <div className="card">
          <button
            type="button"
            className="sx-prow"
            onClick={() => !ro && setPicking(true)}
            data-sm-set-store
          >
            {main ? (
              <Mono chain={main.chain} size={32} />
            ) : (
              <span className="ic">
                <I d={P.supermarket} />
              </span>
            )}
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ display: "block" }}>{L.mainStore}</b>
              <span className="tiny bidi" style={{ display: "block" }}>
                {main ? name(main.chain, main.branch) : L.noStore}
                {also.length
                  ? ` · ${L.alsoAt} ${also.map((x) => name(x.chain, x.branch)).join(", ")}`
                  : ""}
              </span>
            </span>
            <I d={P.chevron} size="sm" className="flip" />
          </button>
          <button
            type="button"
            className="sx-prow"
            onClick={() => !ro && setOrdering(true)}
            data-sm-set-order
          >
            <span className="ic">
              <I d={P.order} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ display: "block" }}>{L.order}</b>
              <span className="tiny" style={{ display: "block" }}>
                {learnedOrders > 1
                  ? f(L.orderSub, { n: learnedOrders })
                  : L.orderSubOne}
              </span>
            </span>
            <I d={P.chevron} size="sm" className="flip" />
          </button>
        </div>
        <div className="card">
          <button
            type="button"
            className="sx-prow"
            onClick={() => go("smHidden")}
            data-sx-nav="smHidden"
          >
            <span className="ic">
              <I d={P.smHidden} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ display: "block" }}>{L.hidden}</b>
              <span className="tiny" style={{ display: "block" }}>
                {L.hiddenSub}
              </span>
            </span>
            {!!hidden?.length && (
              <span className="val tabular">{hidden.length}</span>
            )}
            <I d={P.chevron} size="sm" className="flip" />
          </button>
          <button
            type="button"
            className="sx-prow"
            onClick={() => go("smLearned")}
            data-sx-nav="smLearned"
          >
            <span
              className="ic"
              style={{
                background:
                  "color-mix(in oklab, var(--spark) 14%, transparent)",
                color: "var(--spark)",
              }}
            >
              <I d={P.smLearned} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ display: "block" }}>{L.learned}</b>
              <span className="tiny" style={{ display: "block" }}>
                {L.learnedSub}
              </span>
            </span>
            <I d={P.chevron} size="sm" className="flip" />
          </button>
        </div>
        {/* R18 S5 F6: how often, the usual days, store / online. */}
        <div className="card" style={{ padding: 16 }}>
          <SmHabits />
        </div>
        <p className="tiny" style={{ margin: "0 4px" }}>
          {L.foot}
        </p>
        {sheets}
      </div>
    );

  // Computer: a label column + a control column per row (board Settings-desktop).
  const rowCls =
    "grid grid-cols-[minmax(0,240px)_minmax(0,1fr)] gap-8 border-t border-line py-5 first:border-t-0";
  return (
    <div className="flex flex-col" data-settings-sm>
      <SectionHead title={t.sx.sections.supermarket}>
        <span className="sub">
          {f(L.forSpace, { space: s.space?.name ?? "" })}
        </span>
      </SectionHead>
      <div className={rowCls}>
        <div>
          <b className="block text-[15px]">{L.mainStore}</b>
        </div>
        <div className="flex flex-col gap-2.5">
          <div
            className="flex items-center gap-3 rounded-[16px] border border-line-strong p-3"
            data-sm-set-store
          >
            {main ? <Mono chain={main.chain} size={44} /> : null}
            <span className="min-w-0 flex-1">
              <b className="bidi block truncate text-[15.5px]">
                {main ? name(main.chain, "") : L.noStore}
              </b>
              {main?.branch && (
                <span className="bidi block truncate text-[13px] text-muted">
                  {main.branch}
                </span>
              )}
            </span>
            {!ro && (
              <button
                type="button"
                className="btn"
                onClick={() => setPicking(true)}
                data-sm-set-store-change
              >
                {t.sm.main.changeStore}
              </button>
            )}
          </div>
          {also.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
              {L.alsoAt}
              {also.map((x) => (
                <span
                  key={`${x.chain}|${x.branch}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-ink"
                >
                  <Mono chain={x.chain} size={20} />
                  <span className="bidi">{name(x.chain, x.branch)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={rowCls}>
        <b className="block text-[15px]">{L.order}</b>
        <div className="flex flex-col gap-2.5">
          <div className="gro-rail" aria-hidden>
            {order.map((k) => (
              <i
                key={k}
                style={
                  { "--k": sectionColor(k), "--n": 1 } as React.CSSProperties
                }
              />
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="tiny">
              {learnedOrders > 1
                ? f(L.orderSub, { n: learnedOrders })
                : L.orderSubOne}
              {waiting ? ` · ${waiting}` : ""}
            </span>
            {!ro && (
              <button
                type="button"
                className="btn"
                onClick={() => setOrdering(true)}
                data-sm-set-order
              >
                {t.sm.lists.edit}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className={rowCls}>
        <div>
          <b className="block text-[15px]">{L.hidden}</b>
          <span className="tiny">{L.hiddenSub}</span>
        </div>
        <HiddenList rows={hidden} setRows={setHidden} />
      </div>
      <div className={rowCls}>
        <div>
          <b className="block text-[15px]">{L.learned}</b>
          <span className="tiny">{L.learnedSub}</span>
        </div>
        <div className="flex flex-col items-start gap-3">
          <div className="flex flex-wrap gap-2">
            {(facts ?? []).slice(0, 6).map((x) => (
              <FactChip key={x.key + x.kind} fact={x} />
            ))}
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => go("smLearned")}
            data-sx-nav="smLearned"
          >
            {L.learned}
          </button>
        </div>
      </div>
      <div className={rowCls}>
        <b className="block text-[15px]">{t.sx.hh.habits}</b>
        <SmHabits />
      </div>
      <p className="tiny" style={{ marginTop: 8 }}>
        {L.foot}
      </p>
      {sheets}
    </div>
  );
}

// ---------- products you hid ----------

function HiddenList({
  rows,
  setRows,
}: {
  rows: Hidden[] | null;
  setRows: (r: Hidden[] | null) => void;
}) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const L = t.sm.set;
  const ro = s.readOnly;
  const when = (ts: number) =>
    new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", {
      day: "numeric",
      month: "short",
    }).format(ts);
  const again = async (r: Hidden) => {
    setRows((rows ?? []).filter((x) => x.productKey !== r.productKey));
    try {
      await unhideProduct(r.productKey);
      toast.success(f(L.againDone, { title: r.title }));
      void refreshSmHome(s.spaceId || "-", locale);
    } catch {
      setRows(rows);
      toast.error(L.failed);
    }
  };
  if (rows && !rows.length)
    return (
      <div className="card" style={{ padding: 18 }} data-sm-hidden-none>
        <b>{L.hiddenNone}</b>
        <p className="tiny" style={{ margin: "4px 0 0" }}>
          {L.hiddenNoneSub}
        </p>
      </div>
    );
  return (
    <div className="card" data-sm-hidden>
      {(rows ?? []).map((r) => {
        const who =
          r.hiddenBy === s.me?.id
            ? null
            : (s.people.find((p) => p.id === r.hiddenBy)?.name?.split(" ")[0] ??
              null);
        return (
          <div
            key={r.productKey}
            className="li"
            data-sm-hidden-row={r.productKey}
          >
            <ProductTile art={r.art} section={r.section} size={40} />
            <span className="grow" style={{ minWidth: 0 }}>
              <b className="bidi">{r.title}</b>
              <br />
              <span className="tiny">
                {who
                  ? f(L.hiddenBy, { who, when: when(r.hiddenAt) })
                  : f(L.hiddenByYou, { when: when(r.hiddenAt) })}
              </span>
            </span>
            {!ro && (
              <button
                type="button"
                className="btn"
                onClick={() => void again(r)}
                data-sm-hidden-again
              >
                {L.again}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SmHiddenPage({ phone }: PageProps) {
  const { t } = useI18n();
  const { rows, setRows } = useHidden();
  return (
    <div className="flex flex-col gap-3" data-settings-sm-hidden>
      {!phone && <SectionHead title={t.sx.sections.smHidden} />}
      <p className="sub" style={{ margin: "0 4px" }}>
        {t.sm.set.hiddenIntro}
      </p>
      <HiddenList rows={rows} setRows={setRows} />
    </div>
  );
}

// ---------- what Nexus learned ----------

function useFactText() {
  const { t, f, locale } = useI18n();
  const L = t.sm.set;
  const name = useStoreName();
  return (x: LearnedFact) => {
    const a = x.args;
    if (x.kind === "day") {
      const h = Number(a.hour);
      const part =
        h < 11 ? L.morning : h < 14 ? L.noon : h < 17 ? L.afternoon : L.evening;
      const day =
        locale === "he"
          ? ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"][
              Number(a.weekday)
            ]
          : new Intl.DateTimeFormat("en-US", {
              weekday: "long",
              timeZone: "UTC",
            }).format(Date.UTC(2026, 9, 4 + Number(a.weekday)));
      return f(L.usualDay, { day, part });
    }
    if (x.kind === "store")
      return f(L.mainStoreFact, {
        store: name(String(a.chain), String(a.branch)),
      });
    if (x.kind === "sometimes")
      return f(L.sometimes, { store: name(String(a.chain), "") });
    if (x.kind === "regular")
      return Number(a.days) === 7
        ? f(L.weekly, { title: a.title })
        : f(L.every, { title: a.title, n: a.days });
    if (x.kind === "shabbat") return f(L.shabbat, { title: a.title });
    if (x.kind === "brand") {
      const type = typeOf(String(a.type));
      return f(L.brand, {
        type: type ? (locale === "he" ? type.he : type.en) : String(a.type),
        brand: a.brand,
      });
    }
    return f(L.with, { title: a.title, with: a.with });
  };
}

function FactChip({
  fact,
  onForget,
  onFix,
}: {
  fact: LearnedFact | { key: string; told: true; text: string };
  onForget?: () => void;
  onFix?: () => void;
}) {
  const { t, f } = useI18n();
  const L = t.sm.set;
  const text = useFactText();
  const label = "text" in fact ? fact.text : text(fact);
  const told = "text" in fact || fact.told;
  return (
    <span
      className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-[12px] border border-line-strong bg-surface ps-3 pe-1 text-[14.5px]"
      data-sm-fact={fact.key}
      data-told={told ? "1" : "0"}
    >
      <b className="bidi min-w-0 truncate font-bold">{label}</b>
      <span className="shrink-0 text-[11.5px] text-muted">
        {told ? L.told : L.learnedTag}
      </span>
      {told && onFix && (
        <button
          type="button"
          className="grid size-8 shrink-0 place-items-center rounded-full text-muted active:scale-90"
          aria-label={f(L.fix, { fact: label })}
          onClick={onFix}
          data-sm-fact-fix
        >
          <Pencil className="size-3.5" />
        </button>
      )}
      {!told && onForget && (
        <button
          type="button"
          className="grid size-8 shrink-0 place-items-center rounded-full text-muted active:scale-90"
          aria-label={f(L.forget, { fact: label })}
          onClick={onForget}
          data-sm-fact-forget
        >
          <X className="size-4" />
        </button>
      )}
      {!onForget && !onFix && <span className="w-1.5" />}
    </span>
  );
}

export function SmLearnedPage({ go, phone }: PageProps) {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const L = t.sm.set;
  const ro = s.readOnly;
  const { facts, setFacts, load } = useLearned();
  const [picking, setPicking] = useState(false);
  const [more, setMore] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const desk = useDevice() === "computer";
  const mc = capFor(monthKeyIn(s.clock.now, s.clock.tz), s.budget);
  // What people told Nexus (onboarding / Settings): ✎ opens the place it changes.
  const told = useMemo(() => {
    const who =
      s.obWho === "me"
        ? L.people1
        : s.obWho === "partner"
          ? L.people2
          : s.obWho === "family"
            ? L.peopleFamily
            : null;
    const out: { key: string; told: true; text: string; fix: () => void }[] =
      [];
    if (who)
      out.push({
        key: "told:who",
        told: true,
        text: who,
        fix: () => go("people"),
      });
    out.push({
      key: "told:budget",
      told: true,
      text:
        mc?.cap != null
          ? f(L.budget, { amount: formatMoney(mc.cap, mc.currency, locale) })
          : L.noBudget,
      fix: () => go("budget"),
    });
    return out;
  }, [s.obWho, mc, locale, L, f, go]);
  // One fact: one tap, with Undo (R18 S3 B10) — its cut-off goes back to what it was.
  const forget = async (key: string) => {
    setFacts((facts ?? []).filter((x) => x.key !== key));
    try {
      const { prev } = await forgetLearned(key);
      toast.success(L.forgotten, {
        duration: 5000,
        action: {
          label: L.undo,
          onClick: () =>
            void undoForgetLearned(key, prev).then(() => {
              void refreshSmHome(s.spaceId || "-", locale);
              load();
            }),
        },
      });
      void refreshSmHome(s.spaceId || "-", locale);
      load();
    } catch {
      toast.error(L.failed);
      load();
    }
  };
  const forgetAll = async () => {
    setConfirm(false);
    try {
      await forgetLearned("all");
      toast.success(L.forgotAll);
      void refreshSmHome(s.spaceId || "-", locale);
      load();
    } catch {
      toast.error(L.failed);
    }
  };
  const group = (g: LearnedFact["group"]) =>
    (facts ?? []).filter((x) => x.group === g);
  const regular = group("regular");
  const shownRegular = more ? regular : regular.slice(0, 4);
  const chips = (xs: LearnedFact[]) =>
    xs.map((x) => (
      <FactChip
        key={x.key + x.kind}
        fact={x}
        onForget={ro ? undefined : () => void forget(x.key)}
        onFix={x.told ? () => setPicking(true) : undefined}
      />
    ));
  const head = (title: string) => (
    <p className="sec" style={{ margin: "14px 4px 8px" }}>
      {title}
    </p>
  );
  return (
    <div className="flex flex-col" data-settings-sm-learned>
      {!phone && <SectionHead title={t.sx.sections.smLearned} />}
      <p className="sub" style={{ margin: "0 4px" }}>
        {L.learnedIntro}
      </p>
      {/* Computers: the groups in two columns (board Settings-desktop). */}
      <div className="desk:grid desk:grid-cols-2 desk:gap-x-8">
        <div>
          {head(L.gHome)}
          <div className="flex flex-wrap gap-2" data-sm-learned-group="home">
            {told.map((x) => (
              <FactChip key={x.key} fact={x} onFix={ro ? undefined : x.fix} />
            ))}
          </div>
        </div>
        {facts && !facts.length && (
          <p className="tiny" style={{ margin: "16px 4px 0" }}>
            {L.nothing}
          </p>
        )}
        {group("where").length > 0 && (
          <div>
            {head(L.gWhere)}
            <div className="flex flex-wrap gap-2" data-sm-learned-group="where">
              {chips(group("where"))}
            </div>
          </div>
        )}
        {regular.length > 0 && (
          <div>
            {head(L.gRegular)}
            <div
              className="flex flex-wrap gap-2"
              data-sm-learned-group="regular"
            >
              {chips(shownRegular)}
              {!more && regular.length > 4 && (
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center rounded-[12px] border border-line-strong bg-surface px-3 text-[14.5px] font-bold"
                  onClick={() => setMore(true)}
                  data-sm-learned-more
                >
                  {f(L.more, { n: regular.length - 4 })}
                </button>
              )}
            </div>
          </div>
        )}
        {group("habits").length > 0 && (
          <div>
            {head(L.gHabits)}
            <div
              className="flex flex-wrap gap-2"
              data-sm-learned-group="habits"
            >
              {chips(group("habits"))}
            </div>
          </div>
        )}
      </div>
      {!ro && (
        <div className="card" style={{ marginTop: 22 }}>
          <div className="li">
            <span className="grow">
              <b>{L.forgetAll}</b>
              <br />
              <span className="tiny">{L.forgetAllSub}</span>
            </span>
            <button
              type="button"
              className={cn("btn dng-o", desk ? "" : "sm")}
              onClick={() => setConfirm(true)}
              aria-label={L.forgetAllConfirm}
              data-sm-forget-all
            >
              {L.forgetAll}
            </button>
          </div>
        </div>
      )}
      {/* R18 S3 B10: what goes, what stays — then hold 2 s (letting go early cancels). */}
      <Sheet open={confirm} onOpenChange={setConfirm} title={L.forgetAllConfirm} fit className="desk:max-w-[460px]">
        <div className="nx flex flex-col gap-3 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-1" data-sm-forget-sheet>
          <h2 className="text-[20px] font-extrabold leading-tight">{L.forgetAllConfirm}</h2>
          <div>
            <b className="text-[13.5px] font-bold text-danger">{L.forgetGoes}</b>
            <ul className="mt-1.5 flex list-disc flex-col gap-1 ps-5 text-[14px]" data-sm-forget-goes>
              {L.forgetGoesList.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
          <div>
            <b className="text-[13.5px] font-bold text-ok">{L.forgetStays}</b>
            <ul className="mt-1.5 flex list-disc flex-col gap-1 ps-5 text-[14px] text-muted" data-sm-forget-stays>
              {L.forgetStaysList.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
          <HoldButton label={L.forgetHold} aria={L.forgetHoldAria} onDone={() => void forgetAll()} onConfirm={() => void forgetAll()} phone data="sm-forget-hold" />
          <button type="button" className="h-11 w-full text-[15px] font-bold" onClick={() => setConfirm(false)}>
            {t.sm.lists.cancel}
          </button>
        </div>
      </Sheet>
      <StorePicker open={picking} onClose={() => setPicking(false)} />
    </div>
  );
}
