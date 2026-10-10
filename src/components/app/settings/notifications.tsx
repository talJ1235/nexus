"use client";

import "../../notify/nx18.css";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/providers";
import { setNotificationsOn } from "@/app/home-actions";
import { notifyBoot } from "@/app/notify-actions";
import { DEFAULT_NOTIFY } from "@/lib/home";
import { pushEnv } from "@/lib/notify/client";
import { toast } from "@/lib/toast";
import { AllowSteps } from "../../notify/allow";
import { turnOnHere, usePerm } from "../../notify/inbox";
import { inboxStore, useInbox } from "../../notify/inbox-state";
import { useStore } from "../store";
import type { PageProps } from "./shell";
import { I, Li, P, SectionHead, Toggle } from "./ui";

// R17 S3 N1 — Account → Notifications (board Settings-notify-phone): the one switch ("On all your devices"), this
// device's state (Allowed · Blocked → How to allow · Not turned on yet → Turn on), the quiet hours (a fact, not a
// setting) and one line on how Nexus decides. No per-kind switches.

const PHONE_D = "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M11 18h2";
const COMPUTER_D = "M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z M8 20h8 M12 16v4";
const MOON_D = "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z";

/** The Account row that opens this page. */
export function NotificationsLink({ go }: { go: PageProps["go"] }) {
  const s = useStore();
  const { t } = useI18n();
  const n = s.homePrefs.notify ?? DEFAULT_NOTIFY;
  return (
    <div className="card">
      <button type="button" className="sx-prow" onClick={() => go("notifications")} data-notifications-row>
        <span className="ic">
          <I d={P.bell} />
        </span>
        <span style={{ flex: 1 }}>{t.sx.notifTitle}</span>
        <span className="val">{n.on ? t.sx.on : t.sx.off}</span>
        <I d={P.chevron} size="sm" className="flip" />
      </button>
    </div>
  );
}

export function NotificationsPage({ phone }: PageProps) {
  const s = useStore();
  const { t } = useI18n();
  const st = t.nt.set;
  const n = s.homePrefs.notify ?? DEFAULT_NOTIFY;
  const { boot } = useInbox();
  const [perm, refresh] = usePerm();
  const [how, setHow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [device] = useState(() => (typeof window === "undefined" ? "computer" : pushEnv().device));
  // The push key (for Turn on) when Settings opened before the app's boot call finished.
  useEffect(() => {
    if (!inboxStore.get().boot) notifyBoot().then(inboxStore.setBoot, () => {});
  }, []);
  const set = (on: boolean) => {
    const before = s.homePrefs;
    s.setHomePrefs({ ...before, notify: { ...n, on } });
    if (boot) inboxStore.setBoot({ ...boot, on });
    setNotificationsOn(on).catch(() => {
      s.setHomePrefs(before);
      toast.error(t.errors.generic);
    });
  };
  const turnOn = async () => {
    setBusy(true);
    await turnOnHere(boot?.publicKey ?? null, t.nt).catch(() => {});
    setBusy(false);
    refresh();
  };
  const here = device === "phone" ? st.thisPhone : st.thisComputer;
  return (
    <>
      <SectionHead title={t.sx.sections.notifications} />
      <div className="card" data-notify-settings>
        <Li icon={<I d={P.bell} />} title={t.nt.title} sub={st.allDevices} data-notify-master>
          <Toggle on={n.on} label={t.nt.title} onChange={set} data-notifications-on />
        </Li>
        {n.on && (
          <>
            <Li
              icon={<I d={device === "phone" ? PHONE_D : COMPUTER_D} />}
              title={here}
              sub={perm === "granted" ? (device === "phone" ? st.showsPhone : st.showsComputer) : perm === "denied" ? st.blocked : perm === "iphone-browser" ? st.iphone : perm === "unsupported" ? undefined : st.notYet}
              data-notify-device={perm}
            >
              {perm === "granted" ? (
                <span className="stat-ok">
                  <span className="sdot" />
                  {st.allowed}
                </span>
              ) : perm === "denied" || perm === "iphone-browser" ? (
                <button type="button" className="btn sm" onClick={() => setHow((v) => !v)} aria-expanded={how} data-notify-how>
                  {t.nt.how}
                </button>
              ) : perm === "default" ? (
                <button type="button" className="btn sm pri" onClick={() => void turnOn()} disabled={busy} data-notify-turn-on>
                  {t.nt.turnOn}
                </button>
              ) : null}
            </Li>
            {how && (perm === "denied" || perm === "iphone-browser") && (
              <div className="li" style={{ display: "block" }}>
                <AllowSteps phone={phone} iphone={perm === "iphone-browser"} />
              </div>
            )}
            <Li icon={<I d={MOON_D} />} title={st.quiet} sub={st.quietLine} data-notify-quiet />
          </>
        )}
      </div>
      <p className="tiny" style={{ padding: "10px 4px 0", margin: 0, lineHeight: 1.5 }}>
        {st.footnote}
      </p>
    </>
  );
}
