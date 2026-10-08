"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/providers";
import { toast } from "@/lib/toast";
import { useStore } from "../store";
import { InviteDialog, MoveDialog } from "./dialogs";
import { IdentityDialog } from "./identity";
import { SwitchMoment } from "./moment";
import { NOW_IN_KEY, onOpenSpaces, useSwitchSpace, type SpaceDialog } from "./space-ui";

/** Mounted once in the app shell: the space dialogs, Ctrl/⌘+1…9 to switch, the "Now in …" toast after a switch,
 *  and the deep links /?welcome=household (create) and /?panel=space (back from a step-up sign-in). */
export function SpacesLayer() {
  const s = useStore();
  const { f, t } = useI18n();
  const [d, setD] = useState<SpaceDialog | null>(null);
  const go = useSwitchSpace();

  // R16 D2: Space settings are a section group of Settings now.
  useEffect(() => onOpenSpaces((x) => (x.kind === "settings" ? s.openSettings("space", x.from) : setD(x))), [s]);

  useEffect(() => {
    if (s.loading) return;
    try {
      const msg = sessionStorage.getItem(NOW_IN_KEY);
      if (msg) {
        sessionStorage.removeItem(NOW_IN_KEY);
        // Either a space name ("Now in …") or a finished sentence from settings (left, deleted, restored…).
        toast(msg === s.space?.name ? f(t.spaces.now, { space: msg }) : msg, { duration: 2600 });
      }
    } catch {
      /* private mode */
    }
    const u = new URL(window.location.href);
    const welcome = u.searchParams.get("welcome") === "household";
    const panel = u.searchParams.get("panel") === "space";
    if (welcome || panel) {
      u.searchParams.delete("welcome");
      if (panel) u.searchParams.delete("panel");
      window.history.replaceState(null, "", u);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time deep link
      if (welcome) setD({ kind: "create" });
      else s.openSettings("space");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.loading]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || !/^[1-9]$/.test(e.key)) return;
      const sp = s.spaces[Number(e.key) - 1];
      if (!sp) return;
      e.preventDefault();
      if (sp.id !== s.space?.id) void go(sp.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s.spaces, s.space, go]);

  const close = (o: boolean) => !o && setD(null);
  return (
    <>
      <InviteDialog open={d?.kind === "invite"} onOpenChange={close} />
      <IdentityDialog open={d?.kind === "identity" || d?.kind === "create"} create={d?.kind === "create"} onOpenChange={close} />
      <MoveDialog collectionId={d?.kind === "move" ? d.collectionId : null} onOpenChange={close} />
      <SwitchMoment />
    </>
  );
}
