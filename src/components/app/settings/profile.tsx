"use client";

import { useRef, useState } from "react";
import { loadAppData } from "@/app/data-actions";
import { useI18n } from "@/components/providers";
import { saveMyName } from "@/app/account-actions";
import { initialOf } from "@/lib/initial";
import { toast } from "@/lib/toast";
import { PersonPhoto } from "../person-photo";
import { useStore } from "../store";
import { avatarColor } from "../spaces/space-ui";
import { clamp, Cropper, decode, exportCrop, MAX_IN, ZoomSlider, type Crop } from "../spaces/identity";
import { isUserPhoto, personPhoto } from "../spaces/look";
import type { PageProps } from "./shell";
import { I, Li, P, SectionHead } from "./ui";

// R17 P3: Settings → Profile — who you are to the people in your spaces: photo (Google's from sign-up by default; upload
// + crop with the space-photo cropper in a circle; remove → initials), display name (1–40, shown everywhere), email
// (read-only, from Google), member since, and the way on to Account & security (sign-in, devices, delete).

const NAME_MAX = 40;

export function ProfilePage({ go, phone }: PageProps) {
  const s = useStore();
  const { t, locale } = useI18n();
  const x = t.sx.pf;
  const me = s.me;
  const [name, setName] = useState(me?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();
  const nameOk = trimmed.length >= 1 && trimmed.length <= NAME_MAX;
  const nameDirty = trimmed !== (me?.name ?? "");

  const refresh = () =>
    loadAppData()
      .then((d) => s.replaceData(d, { keepView: true }))
      .catch(() => {});

  const saveName = async () => {
    if (!nameOk || !nameDirty || savingName) return;
    setSavingName(true);
    const r = await saveMyName(trimmed).catch(() => ({ ok: false }));
    setSavingName(false);
    if (!r.ok) return void toast.error(t.errors.generic);
    toast.success(t.sx.nameSaved);
    await refresh();
  };

  const pick = async (fl: File | undefined) => {
    if (file.current) file.current.value = "";
    if (!fl) return;
    if (fl.size > MAX_IN) return void toast.error(t.ident.tooBig);
    try {
      const d = await decode(fl);
      setCrop({ ...d, zoom: 1, rot: 0, x: 0, y: 0 });
    } catch {
      toast.error(t.ident.unreadable);
    }
  };
  const upload = async () => {
    if (!crop || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/me-photo", { method: "POST", headers: { "content-type": "image/jpeg" }, body: await exportCrop(crop, 512) });
      if (!r.ok) throw new Error(String(r.status));
      setCrop(null);
      toast.success(x.saved);
      await refresh();
    } catch {
      toast.error(t.ident.unreadable);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/me-photo", { method: "DELETE" });
      if (!r.ok) throw new Error(String(r.status));
      toast.success(x.removed);
      await refresh();
    } catch {
      toast.error(t.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const photo = personPhoto(me?.image);
  const source = !photo ? x.photoNone : isUserPhoto(photo) ? x.photoOwn : x.photoGoogle;
  const since = me?.since ? new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-US", { year: "numeric", month: "long", day: "numeric" }).format(me.since) : null;
  const box = phone ? 260 : 240;

  return (
    <>
      <SectionHead title={t.sx.sections.profile} />
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={(e) => void pick(e.target.files?.[0])} data-profile-file />

      <div className="card" style={{ padding: "18px 18px 16px", borderRadius: 14, background: "var(--s)" }} data-profile-photo>
        {crop ? (
          <div style={{ display: "flex", flexDirection: phone ? "column" : "row", gap: 18, alignItems: phone ? "center" : "flex-start" }} data-profile-crop>
            <Cropper crop={crop} setCrop={setCrop} frame={box - 40} box={box} round />
            <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minWidth: 0, width: phone ? "100%" : undefined }}>
              <b>{x.crop}</b>
              <span className="tiny">{t.ident.dragToMove}</span>
              <ZoomSlider crop={crop} setCrop={setCrop} />
              <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => setCrop(clamp({ ...crop, rot: ((crop.rot + 90) % 360) as Crop["rot"] }))} data-profile-rotate>
                <I d={P.refresh} size="sm" />
                {t.ident.rotate}
              </button>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button type="button" className="btn pri" disabled={busy} onClick={() => void upload()} data-profile-use>
                  {x.use}
                </button>
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setCrop(null)}>
                  {x.cancel}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span style={{ display: "inline-grid", width: 72, height: 72 }}>
              <span className="av xl" style={{ width: 72, height: 72, fontSize: 26, background: avatarColor(me?.id ?? "") }} aria-hidden data-profile-avatar={photo ? "photo" : "initials"}>
                <PersonPhoto url={me?.image} fallback={initialOf(me?.name || me?.email || "?")} />
              </span>
            </span>
            <span style={{ flex: 1, minWidth: 150, lineHeight: 1.35 }}>
              <b>{x.photo}</b>
              <br />
              <span className="tiny">{source}</span>
            </span>
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn sm" disabled={busy} onClick={() => file.current?.click()} data-profile-change>
                <I d={P.picture} size="sm" />
                {photo ? x.change : x.add}
              </button>
              {photo && (
                <button type="button" className="btn sm ghost" disabled={busy} onClick={() => void remove()} data-profile-remove>
                  {x.remove}
                </button>
              )}
            </span>
          </div>
        )}
      </div>

      <p className="sec">{x.name}</p>
      <div className="card" style={{ padding: "14px 16px" }} data-profile-name>
        <form
          style={{ display: "flex", gap: 8, alignItems: "center" }}
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <label className="input" style={{ flex: 1, minWidth: 0, height: 42 }}>
            <input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} aria-label={x.name} aria-invalid={!nameOk} dir="auto" autoComplete="name" data-profile-name-input />
          </label>
          <button type="submit" className="btn pri" style={{ height: 42 }} disabled={!nameOk || !nameDirty || savingName} data-profile-name-save>
            {t.sx.save}
          </button>
        </form>
        <span className="tiny" style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 8 }}>
          <span>{x.nameHint}</span>
          <span className="num" style={{ color: nameOk ? undefined : "var(--dng)" }} aria-live="polite">
            {nameOk ? `${trimmed.length}/${NAME_MAX}` : x.nameLen}
          </span>
        </span>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <Li icon={P.mail} title={x.email} sub={x.emailHint} data-profile-email>
          <span className="bidi tiny" style={{ maxWidth: phone ? 150 : 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink2)", fontSize: 13.5 }} title={me?.email}>
            {me?.email}
          </span>
        </Li>
        {since && (
          <Li icon={P.calendar} title={x.since} data-profile-since>
            <span className="tiny" style={{ color: "var(--ink2)", fontSize: 13.5 }}>
              {since}
            </span>
          </Li>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <button type="button" className="sx-prow" onClick={() => go("account")} data-profile-security>
          <span className="ic">
            <I d={P.account} />
          </span>
          <span style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
            {t.sx.sections.account}
            <br />
            <span className="tiny">{x.security}</span>
          </span>
          <I d={P.chevron} size="sm" className="flip" />
        </button>
      </div>
    </>
  );
}
