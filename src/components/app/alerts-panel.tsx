"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellRing, Check, ExternalLink, RefreshCw, Send, Unlink } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/lib/toast";
import { checkPricesNow, getAlertsState, markAlertsRead, saveAlertPrefs, tgDisconnect, tgFinishLink, tgSaveToken, tgStartLink, tgTest, type AlertsState } from "@/app/alert-actions";
import { useI18n } from "@/components/providers";
import { Button, Input } from "@/components/ui/button";
import { Sheet, SheetClose } from "@/components/ui/overlays";
import { formatMoney } from "@/lib/money";
import type { Alert } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProductImage } from "./item-card";
import { Segmented } from "./settings-dialog";
import { useStore } from "./store";
import { useExtension } from "./use-extension";

function timeAgo(ts: number, locale: string) {
  const rtf = new Intl.RelativeTimeFormat(locale === "he" ? "he" : "en", { numeric: "auto" });
  const m = Math.round((ts - Date.now()) / 60000);
  if (Math.abs(m) < 60) return rtf.format(m, "minute");
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return rtf.format(h, "hour");
  return rtf.format(Math.round(h / 24), "day");
}

/** Header bell: unread count, opens the alerts panel. */
export function AlertsBell() {
  const s = useStore();
  const { t } = useI18n();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (s.loading) return;
    let alive = true;
    getAlertsState()
      .then((st) => alive && setUnread(st.unread))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [s.panel, s.loading]);
  return (
    <Button variant="ghost" size="icon" className="relative mt-1.5" onClick={() => s.setPanel("alerts")} aria-label={t.alerts.title} title={t.alerts.title} data-carry="panel:alerts">
      {unread ? <BellRing /> : <Bell />}
      {unread > 0 && (
        <span className="tabular absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-fg">{unread > 9 ? "9+" : unread}</span>
      )}
    </Button>
  );
}

function AlertRow({ a, onOpen }: { a: Alert; onOpen: (id: string) => void }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const item = s.items.find((i) => i.id === a.itemId);
  const m = (n: number | null) => formatMoney(n, a.currency ?? s.currency, locale);
  const pct = a.oldPrice && a.newPrice ? Math.round((1 - a.newPrice / a.oldPrice) * 100) : null;
  const line =
    a.kind === "drop" ? (
      <>
        <span className="text-faint line-through">{m(a.oldPrice)}</span> <b className="text-fg">{m(a.newPrice)}</b> {pct != null && <span className="text-ok">−{pct}%</span>}
      </>
    ) : a.kind === "target" ? (
      <>
        {t.alerts.targetHit} <b className="text-fg">{m(a.newPrice)}</b>
      </>
    ) : a.kind === "back_in_stock" ? (
      t.alerts.backInStock
    ) : (
      t.alerts.outOfStock
    );
  return (
    <button type="button" onClick={() => onOpen(a.itemId)} className={cn("flex w-full items-center gap-3 rounded-xl p-2.5 text-start transition hover:bg-sunken", !a.readAt && "bg-accent-soft/40")}>
      <ProductImage src={item?.imageUrl ?? null} alt="" className="size-11 shrink-0 rounded-lg" iconClass="size-4" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium bidi">
          {item?.title ?? "—"}
        </div>
        <div className="tabular mt-0.5 text-[13px] text-muted">{line}</div>
      </div>
      <span className="shrink-0 text-xs text-faint">{timeAgo(a.createdAt, locale)}</span>
    </button>
  );
}

function TelegramSetup({ st, reload }: { st: AlertsState; reload: () => Promise<void> }) {
  const { t, f } = useI18n();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const stop = useRef(false);

  useEffect(() => () => void (stop.current = true), []);

  if (st.telegram.connected) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="order-last w-full text-xs text-muted">{f(t.alerts.tgAddHint, { bot: st.telegram.bot ?? "" })}</p>
        <span className="inline-flex items-center gap-1.5 text-sm text-ok">
          <Check className="size-4" /> {t.alerts.tgConnected} @{st.telegram.bot}
        </span>
        <div className="ms-auto flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              if (await tgTest(t.alerts.tgTestMsg)) toast.success(t.alerts.tgTestSent);
              else toast.error(t.errors.generic);
            }}
          >
            <Send />
            {t.alerts.tgTest}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await tgDisconnect();
              await reload();
            }}
          >
            <Unlink />
            {t.alerts.tgDisconnect}
          </Button>
        </div>
      </div>
    );
  }

  if (st.telegram.hasToken) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted">{waiting ? t.alerts.tgWaiting : t.alerts.tgStep2}</p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="accent"
            disabled={waiting}
            onClick={async () => {
              const { url } = await tgStartLink();
              window.open(url, "_blank", "noopener");
              setWaiting(true);
              stop.current = false;
              for (let i = 0; i < 45 && !stop.current; i++) {
                await new Promise((r) => setTimeout(r, 2000));
                if (await tgFinishLink()) {
                  toast.success(t.alerts.tgConnected);
                  await tgTest(t.alerts.tgWelcome);
                  break;
                }
              }
              setWaiting(false);
              await reload();
            }}
          >
            {waiting ? <Spinner /> : <Send />}
            {t.alerts.tgConnect} @{st.telegram.bot}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <ol className="list-inside list-decimal space-y-1 text-sm text-muted">
        <li>
          {t.alerts.tgStep1a}{" "}
          <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="font-medium text-accent-ink hover:underline">
            @BotFather <ExternalLink className="inline size-3" />
          </a>{" "}
          {t.alerts.tgStep1b}
        </li>
        <li>{t.alerts.tgStep1c}</li>
      </ol>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const r = await tgSaveToken(token);
          setBusy(false);
          if (!r.ok) return toast.error(t.alerts.tgBadToken);
          setToken("");
          await reload();
        }}
      >
        <Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AA…" dir="ltr" className="h-9" />
        <Button type="submit" size="sm" variant="accent" className="h-9" disabled={busy || token.length < 20}>
          {busy ? <Spinner /> : t.item.save}
        </Button>
      </form>
    </div>
  );
}

export function AlertsPanel() {
  const s = useStore();
  const { t, f, locale } = useI18n();
  const ext = useExtension();
  const [st, setSt] = useState<AlertsState | null>(null);
  const [checking, setChecking] = useState(false);
  const open = s.panel === "alerts";

  const reload = useCallback(async () => setSt(await getAlertsState()), []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    getAlertsState().then((x) => alive && setSt(x));
    // Opening the panel counts as reading the alerts.
    const timer = setTimeout(() => void markAlertsRead(), 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open]);

  // /?panel=alerts (from the Telegram digest link) opens the panel.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("panel") === "alerts") {
      s.setPanel("alerts");
      const u = new URL(window.location.href);
      u.searchParams.delete("panel");
      window.history.replaceState(null, "", u);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkNow = async () => {
    setChecking(true);
    try {
      const r = await checkPricesNow(window.location.origin);
      s.setItems(r.items);
      toast.success(f(t.alerts.checkedN, { n: r.checked, a: r.alerts }), { description: r.blocked && !ext.available ? f(t.alerts.blockedHint, { n: r.blocked }) : undefined });
      if (ext.available) window.postMessage({ source: "nexus-app", type: "check-prices" }, window.location.origin);
      await reload();
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && s.setPanel(null)} title={t.alerts.title}>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Bell className="size-4 text-muted" />
            {t.alerts.title}
          </h2>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={checkNow} disabled={checking}>
              {checking ? <Spinner /> : <RefreshCw />}
              {t.alerts.checkNow}
            </Button>
            <SheetClose className="grid size-8 place-items-center rounded-md text-muted hover:bg-sunken hover:text-fg" aria-label="Close">
              ×
            </SheetClose>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!st ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-14 rounded-xl" />
              ))}
            </div>
          ) : (
            <>
              <p className="px-4 pt-3 text-xs text-faint">
                {st.lastCheck ? f(t.alerts.lastCheck, { time: timeAgo(st.lastCheck.at, locale), n: st.lastCheck.checked }) : t.alerts.daily}
              </p>
              <div className="space-y-0.5 p-2">
                {st.alerts.length ? (
                  st.alerts.map((a) => (
                    <AlertRow
                      key={a.id}
                      a={a}
                      onOpen={(id) => {
                        s.setPanel(null);
                        s.openItem(id);
                      }}
                    />
                  ))
                ) : (
                  <p className="px-3 py-8 text-center text-sm text-muted">{t.alerts.empty}</p>
                )}
              </div>

              <section className="space-y-4 border-t border-line p-4">
                <h3 className="text-xs font-medium text-faint">{t.alerts.when}</h3>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm">{t.alerts.minDrop}</span>
                  <Segmented
                    size="sm"
                    label={t.alerts.minDrop}
                    value={String(st.prefs.minDropPct)}
                    onChange={async (v) => setSt({ ...st, prefs: await saveAlertPrefs({ minDropPct: Number(v) }) })}
                    options={["3", "5", "10", "20"].map((v) => ({ value: v, label: `${v}%` }))}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm">{t.alerts.backInStockPref}</span>
                  <Segmented
                    size="sm"
                    label={t.alerts.backInStockPref}
                    value={st.prefs.backInStock ? "on" : "off"}
                    onChange={async (v) => setSt({ ...st, prefs: await saveAlertPrefs({ backInStock: v === "on" }) })}
                    options={[
                      { value: "on", label: t.alerts.on },
                      { value: "off", label: t.alerts.off },
                    ]}
                  />
                </div>
                <p className="text-xs text-muted">{t.alerts.targetHint}</p>
              </section>

              <section className="space-y-3 border-t border-line p-4">
                <h3 className="text-xs font-medium text-faint">Telegram</h3>
                <TelegramSetup st={st} reload={reload} />
              </section>

              {!ext.available && (
                <p className="border-t border-line p-4 text-xs text-muted">{t.alerts.extHint}</p>
              )}
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
