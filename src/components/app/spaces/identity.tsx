"use client";

import "../../auth/nx.css";
import "../settings/nx16.css";
import { useEffect, useRef, useState } from "react";
import { Dialog as D } from "radix-ui";
import { createSpace, updateCurrentSpace } from "@/app/space-actions";
import { loadAppData } from "@/app/data-actions";
import { useI18n } from "@/components/providers";
import { useBackClose } from "@/components/ui/sheet-drag";
import { useMedia } from "@/components/ui/use-media";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useStore } from "../store";
import { I, P, Seg } from "../settings/ui";
import { InvitePanel } from "./dialogs";
import { COLOR_KEYS, gradientOf, ICON_KEYS, isSpacePhoto, SPACE_ICONS } from "./look";
import { Facepile, reloadInto, SpaceTile } from "./space-ui";

/**
 * R16 D5 — the space's look, for create and edit (boards SpaceIdentity-desktop/-phone): name, then either an icon on
 * one of 6 gradients or a photo — uploaded (or the camera on phones), cropped in a rounded square (drag, wheel/slider or
 * pinch to zoom, rotate 90°) and sent as a square image; the server re-encodes it (512 px WebP, no EXIF). Live preview
 * at the switcher / sidebar / invite sizes. Owners only (the server checks).
 */

const MAX_IN = 10 * 1024 * 1024;
const OUT = 768;

/** Offsets `x`/`y` are in frame units (1 = the crop square's side), so every frame size agrees. */
type Crop = { img: ImageBitmap | HTMLImageElement; w: number; h: number; zoom: number; rot: 0 | 90 | 180 | 270; x: number; y: number };
/** null = keep, "remove" = back to the icon, a crop = upload it. */
type PhotoEdit = null | "remove" | Crop;

async function decode(file: File): Promise<{ img: ImageBitmap | HTMLImageElement; w: number; h: number }> {
  try {
    const b = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { img: b, w: b.width, h: b.height };
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    return { img, w: img.naturalWidth, h: img.naturalHeight };
  }
}

/** Scale (image px → frame units) that makes the rotated image cover the frame at zoom 1. */
const coverScale = (c: Crop) => 1 / Math.min(c.w, c.h);
function clamp(c: Crop): Crop {
  const s = coverScale(c) * c.zoom;
  const W = (c.rot % 180 ? c.h : c.w) * s;
  const H = (c.rot % 180 ? c.w : c.h) * s;
  const mx = Math.max(0, (W - 1) / 2);
  const my = Math.max(0, (H - 1) / 2);
  return { ...c, x: Math.max(-mx, Math.min(mx, c.x)), y: Math.max(-my, Math.min(my, c.y)) };
}

async function exportCrop(c: Crop, out = OUT): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = out;
  const g = canvas.getContext("2d")!;
  const s = coverScale(c) * c.zoom * out;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, out, out);
  g.translate(out / 2 + c.x * out, out / 2 + c.y * out);
  g.rotate((c.rot * Math.PI) / 180);
  g.scale(s, s);
  g.drawImage(c.img, -c.w / 2, -c.h / 2);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.92));
}

export function IdentityDialog({ open, create, onOpenChange }: { open: boolean; create: boolean; onOpenChange: (o: boolean) => void }) {
  const desktop = useMedia("(min-width: 1024px)");
  if (!open) return null;
  return <Identity key={`${create}:${desktop}`} create={create} desktop={desktop} onClose={() => onOpenChange(false)} />;
}

function Identity({ create, desktop, onClose }: { create: boolean; desktop: boolean; onClose: () => void }) {
  const s = useStore();
  const { t, f } = useI18n();
  const x = t.ident;
  const sp = s.space;
  const start = create ? null : sp;
  const [name, setName] = useState(start?.name ?? "");
  const [color, setColor] = useState(start && COLOR_KEYS.includes(start.color) ? start.color : start?.color === "plum" ? "violet" : "green");
  const [icon, setIcon] = useState(start?.icon && SPACE_ICONS[start.icon] ? start.icon : "home");
  const [tab, setTab] = useState<"icon" | "photo">(start && isSpacePhoto(start.photo) ? "photo" : "icon");
  const [photo, setPhoto] = useState<PhotoEdit>(null);
  const [cropOpen, setCropOpen] = useState(false); // phone: the full-screen crop step
  const [sourceOpen, setSourceOpen] = useState(false); // phone: camera / gallery / remove
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useBackClose(!desktop, onClose, "(max-width: 1023px)");

  // The tile preview: the crop rendered small (debounced), the saved photo, or the icon.
  useEffect(() => {
    if (!photo || photo === "remove") return;
    let gone = false;
    const id = setTimeout(() => {
      void exportCrop(photo, 240).then((b) => {
        if (gone) return;
        const u = URL.createObjectURL(b);
        setPreview((old) => (old && URL.revokeObjectURL(old), u));
      });
    }, 120);
    return () => {
      gone = true;
      clearTimeout(id);
    };
  }, [photo]);
  const savedPhoto = start && isSpacePhoto(start.photo) && photo !== "remove" ? start.photo : null;
  const shownPhoto = tab === "photo" ? (photo && photo !== "remove" ? preview : savedPhoto) : null;
  const look = { name: name || (create ? t.spaces.namePh : sp?.name ?? ""), color, icon };

  const pick = async (fl: File | undefined) => {
    if (!fl) return;
    if (fl.size > MAX_IN) return void toast.error(x.tooBig);
    try {
      const d = await decode(fl);
      setPhoto({ ...d, zoom: 1, rot: 0, x: 0, y: 0 });
      setTab("photo");
      if (!desktop) setCropOpen(true);
    } catch {
      toast.error(x.unreadable);
    } finally {
      if (file.current) file.current.value = "";
      if (camera.current) camera.current.value = "";
    }
  };

  const uploadPhoto = async () => {
    if (!photo || photo === "remove") {
      if (photo === "remove" || (tab === "icon" && savedPhoto)) await fetch("/api/space-photo", { method: "DELETE" });
      return true;
    }
    const blob = await exportCrop(photo);
    const r = await fetch("/api/space-photo", { method: "POST", headers: { "content-type": "image/jpeg" }, body: blob });
    return r.ok;
  };

  const save = async () => {
    const nm = name.trim();
    if (!nm || busy) return;
    setBusy(true);
    try {
      if (create) {
        await createSpace({ name: nm, color, icon, currency: s.space?.currency ?? "ILS" });
        if (tab === "photo" && photo && photo !== "remove" && !(await uploadPhoto())) toast.error(x.unreadable);
        setInvite(nm);
        return;
      }
      await updateCurrentSpace({ name: nm, color, icon });
      if (!(await uploadPhoto())) toast.error(x.unreadable);
      const d = await loadAppData();
      s.replaceData(d, { keepView: true });
      toast.success(x.saved);
      onClose();
    } catch {
      toast.error(t.spaces.failed);
    } finally {
      setBusy(false);
    }
  };
  const finishCreate = () => {
    onClose();
    if (invite) reloadInto(invite);
  };

  const inputs = (
    <>
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={(e) => void pick(e.target.files?.[0])} data-identity-file />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void pick(e.target.files?.[0])} />
    </>
  );

  const colourRow = (
    <div style={{ display: "flex", gap: desktop ? 12 : 0, justifyContent: desktop ? "flex-start" : "space-between", padding: desktop ? 0 : "0 4px" }} role="radiogroup" aria-label={x.colours}>
      {COLOR_KEYS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={color === c}
          aria-label={t.spaces.colors[c as keyof typeof t.spaces.colors]}
          className={cn("sw", color === c && tab === "icon" && "on")}
          style={{ background: gradientOf(c), width: desktop ? 30 : 38, height: desktop ? 30 : 38 }}
          onClick={() => {
            setColor(c);
            setTab("icon");
          }}
          data-identity-color={c}
        />
      ))}
    </div>
  );
  const iconGrid = (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${desktop ? 8 : 6}, minmax(0,1fr))`, gap: desktop ? 6 : 8, justifyItems: "center" }} role="radiogroup" aria-label={x.iconsLabel}>
      {ICON_KEYS.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={icon === k} aria-label={x.icons[k as keyof typeof x.icons]} title={x.icons[k as keyof typeof x.icons]} className={cn("icp", icon === k && "on")} style={desktop ? undefined : { width: 48, height: 48 }} onClick={() => setIcon(k)} data-identity-icon={k}>
          <svg viewBox="0 0 24 24">
            <path d={SPACE_ICONS[k]} />
          </svg>
        </button>
      ))}
    </div>
  );
  const tabs = (
    <Seg
      label={x.title}
      value={tab}
      block={!desktop}
      large={!desktop}
      onChange={(v) => {
        setTab(v);
        if (v === "photo" && !desktop && !photo && !savedPhoto) setSourceOpen(true);
      }}
      options={[
        { value: "icon", label: desktop ? (<><I d={P.ai} size="sm" />{x.tabIcon}</>) : x.tabIcon },
        { value: "photo", label: desktop ? (<><I d={P.picture} size="sm" />{x.tabPhoto}</>) : x.tabPhoto },
      ]}
    />
  );

  if (invite)
    return (
      <D.Root open onOpenChange={(o) => !o && finishCreate()}>
        <D.Portal>
          <div className="nx sx-root">
            <D.Overlay className="sx-scrim overlay-in" />
            <D.Content className={desktop ? "sx-dialog sx-in" : "sx-phone"} style={desktop ? { width: "min(560px,92vw)", height: "auto", maxHeight: "92vh", flexDirection: "column", padding: 24, gap: 16, overflowY: "auto" } : { padding: 16, gap: 16, overflowY: "auto" }} aria-describedby={undefined} data-create-invite>
              <D.Title className="t-h2">{f(t.spaces.inviteTo, { space: invite })}</D.Title>
              <div className="nx-reset" style={{ color: "var(--ink)" }}>
                <InvitePanel name={invite} color={color} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: "auto" }}>
                <button type="button" className="btn ghost" onClick={finishCreate} data-create-skip>
                  {t.spaces.skip}
                </button>
                <button type="button" className="btn pri" onClick={finishCreate} data-create-done>
                  {t.spaces.done}
                </button>
              </div>
            </D.Content>
          </div>
        </D.Portal>
      </D.Root>
    );

  return (
    <D.Root open onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <div className="nx sx-root">
          <D.Overlay className="sx-scrim overlay-in" />
          {desktop ? (
            <D.Content className="sx-dialog sx-in" style={{ width: "min(900px,92vw)", height: "min(620px,92vh)" }} aria-describedby={undefined} data-identity={create ? "create" : "edit"} onOpenAutoFocus={(e) => e.preventDefault()}>
              {inputs}
              <aside style={{ width: 320, flexShrink: 0, background: "linear-gradient(180deg,var(--s),var(--s2))", borderInlineEnd: "1px solid var(--line-in)", padding: "46px 26px 26px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                <SpaceTile {...look} photo={shownPhoto} size={120} style={{ borderRadius: 30, boxShadow: "var(--sh2)" }} />
                <b style={{ fontSize: 18 }} data-identity-preview-name>
                  {look.name}
                </b>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", marginTop: 20 }}>
                  <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
                    <SpaceTile {...look} photo={shownPhoto} size={28} />
                    <b style={{ flex: 1, fontSize: 13 }}>{look.name}</b>
                    <span className="tiny">{x.switcher}</span>
                  </div>
                  <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
                    <SpaceTile {...look} photo={shownPhoto} size={22} />
                    <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{look.name}</span>
                    <span className="tiny">{x.sidebar}</span>
                  </div>
                  <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px" }}>
                    <SpaceTile {...look} photo={shownPhoto} size={40} />
                    <span style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                      <b style={{ fontSize: 13 }}>{f(x.joinName, { name: look.name })}</b>
                      <br />
                      {s.people.length > 0 ? <Facepile people={s.people} size={20} /> : null}
                    </span>
                    <span className="tiny">{x.invite}</span>
                  </div>
                </div>
              </aside>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px 24px 16px", display: "flex", flexDirection: "column", gap: 18 }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <D.Title className="t-h2" style={{ flex: 1 }}>
                      {create ? x.create : x.title}
                    </D.Title>
                    <D.Close className="btn sm icon ghost" aria-label={x.cancel}>
                      <I d={P.close} />
                    </D.Close>
                  </div>
                  <div>
                    <p className="label" style={{ margin: "0 0 6px" }}>
                      {x.name}
                    </p>
                    <label className="input">
                      <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={t.spaces.namePh} aria-label={x.name} autoFocus={create} data-identity-name />
                    </label>
                  </div>
                  <div>{tabs}</div>
                  {tab === "icon" ? (
                    <>
                      {colourRow}
                      {iconGrid}
                    </>
                  ) : photo && photo !== "remove" ? (
                    <div style={{ display: "flex", gap: 18 }}>
                      <Cropper crop={photo} setCrop={setPhoto} frame={210} box={290} />
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                        <span className="tiny">{x.dragToMove}</span>
                        <b style={{ fontSize: 13 }}>{x.zoom}</b>
                        <ZoomSlider crop={photo} setCrop={setPhoto} />
                        <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => setPhoto(clamp({ ...photo, rot: ((photo.rot + 90) % 360) as Crop["rot"] }))} data-identity-rotate>
                          <I d={P.refresh} size="sm" />
                          {x.rotate}
                        </button>
                        <div style={{ borderTop: "1px solid var(--line-in)", margin: "6px 0" }} />
                        <button type="button" className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => file.current?.click()}>
                          {x.replace}
                        </button>
                        <button type="button" className="btn sm ghost" style={{ alignSelf: "flex-start", color: "var(--danger)" }} onClick={() => (setPhoto("remove"), setTab("icon"))} data-identity-remove>
                          {x.remove}
                        </button>
                      </div>
                    </div>
                  ) : savedPhoto ? (
                    <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
                      <SpaceTile {...look} photo={savedPhoto} size={160} style={{ borderRadius: 36 }} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <button type="button" className="btn sm" onClick={() => file.current?.click()}>
                          {x.replace}
                        </button>
                        <button type="button" className="btn sm ghost" style={{ color: "var(--danger)" }} onClick={() => (setPhoto("remove"), setTab("icon"))} data-identity-remove>
                          {x.remove}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <DropZone onFile={(fl) => void pick(fl)} onChoose={() => file.current?.click()} />
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 24px", borderTop: "1px solid var(--line-in)" }}>
                  <span className="tiny" style={{ flex: 1 }}>
                    {create ? "" : x.ownersOnly}
                  </span>
                  <button type="button" className="btn" onClick={onClose}>
                    {x.cancel}
                  </button>
                  <button type="button" className="btn pri" disabled={!name.trim() || busy} onClick={() => void save()} data-identity-save>
                    {create ? x.continue : x.save}
                  </button>
                </div>
              </div>
            </D.Content>
          ) : (
            <D.Content className="sx-phone" aria-describedby={undefined} data-identity={create ? "create" : "edit"} onOpenAutoFocus={(e) => e.preventDefault()}>
              {inputs}
              <div className="sx-pbar" style={{ background: "linear-gradient(180deg,var(--s),var(--bg))", borderBottom: 0 }}>
                <button type="button" className="btn icon ghost" onClick={onClose} aria-label={x.cancel}>
                  <I d={P.back} className="flip" />
                </button>
                <D.Title asChild>
                  <b>{create ? x.create : x.title}</b>
                </D.Title>
                <button type="button" className="btn pri" style={{ height: 38 }} disabled={!name.trim() || busy} onClick={() => void save()} data-identity-save>
                  {create ? x.continue : x.save}
                </button>
              </div>
              <div className="sx-pscroll" style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 4 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, paddingBottom: 14, borderBottom: "1px solid var(--line-in)", margin: "0 -16px", background: "linear-gradient(180deg,var(--bg),var(--s))" }}>
                  <button type="button" onClick={() => tab === "photo" && setSourceOpen(true)} style={{ border: 0, background: "none", padding: 0 }} aria-label={x.tabPhoto}>
                    <SpaceTile {...look} photo={shownPhoto} size={120} style={{ borderRadius: 30, boxShadow: "var(--sh2)" }} />
                  </button>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <SpaceTile {...look} photo={shownPhoto} size={28} />
                    <b style={{ fontSize: 14 }}>{look.name}</b>
                    <SpaceTile {...look} photo={shownPhoto} size={22} />
                  </span>
                </div>
                <label className="input">
                  <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={t.spaces.namePh} aria-label={x.name} data-identity-name />
                </label>
                {tabs}
                {tab === "icon" ? (
                  <>
                    {colourRow}
                    {iconGrid}
                  </>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <button type="button" className="btn block" onClick={() => camera.current?.click()}>
                      <I d={SPACE_ICONS.photo} />
                      {x.takePhoto}
                    </button>
                    <button type="button" className="btn block" onClick={() => file.current?.click()}>
                      <I d={P.picture} />
                      {x.gallery}
                    </button>
                    {photo && photo !== "remove" && (
                      <button type="button" className="btn block" onClick={() => setCropOpen(true)}>
                        {x.dragToMove}
                      </button>
                    )}
                    {(savedPhoto || (photo && photo !== "remove")) && (
                      <button type="button" className="btn block ghost" style={{ color: "var(--danger)" }} onClick={() => (setPhoto("remove"), setTab("icon"))} data-identity-remove>
                        {x.remove}
                      </button>
                    )}
                  </div>
                )}
              </div>
              {sourceOpen && (
                <div style={{ position: "fixed", inset: 0, zIndex: 3, display: "flex", alignItems: "flex-end" }}>
                  <div className="scrim" style={{ position: "absolute", inset: 0 }} onClick={() => setSourceOpen(false)} />
                  <div className="card" style={{ position: "relative", width: "100%", borderRadius: "20px 20px 0 0", padding: "10px 12px calc(14px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, background: "var(--line-strong)", marginBottom: 6 }} />
                    <button type="button" className="sx-prow" onClick={() => (setSourceOpen(false), camera.current?.click())}>
                      <span className="ic">
                        <I d={SPACE_ICONS.photo} />
                      </span>
                      {x.takePhoto}
                    </button>
                    <button type="button" className="sx-prow" onClick={() => (setSourceOpen(false), file.current?.click())}>
                      <span className="ic">
                        <I d={P.picture} />
                      </span>
                      {x.gallery}
                    </button>
                    {savedPhoto && (
                      <button type="button" className="sx-prow" style={{ color: "var(--danger)" }} onClick={() => (setSourceOpen(false), setPhoto("remove"), setTab("icon"))}>
                        <span className="ic dng">
                          <I d={P.trash} />
                        </span>
                        {x.remove}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {cropOpen && photo && photo !== "remove" && (
                <div style={{ position: "fixed", inset: 0, zIndex: 4, background: "#0b0b0b", display: "flex", flexDirection: "column", color: "#fff" }} data-identity-crop>
                  <div style={{ textAlign: "center", fontSize: 13, opacity: 0.85, padding: "max(14px, env(safe-area-inset-top)) 16px 8px" }}>{x.pinch}</div>
                  <div style={{ flex: 1, display: "grid", placeItems: "center", minHeight: 0 }}>
                    <Cropper crop={photo} setCrop={setPhoto} frame={Math.min(300, typeof window === "undefined" ? 300 : window.innerWidth - 90)} box={Math.min(390, typeof window === "undefined" ? 390 : window.innerWidth)} dark />
                  </div>
                  <div style={{ padding: "14px 20px calc(16px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 14, background: "#0b0b0b" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <button type="button" className="btn icon" style={{ borderRadius: 999, background: "#262626", borderColor: "#262626", color: "#fff", width: 48, height: 48 }} aria-label={x.rotate} onClick={() => setPhoto(clamp({ ...photo, rot: ((photo.rot + 90) % 360) as Crop["rot"] }))} data-identity-rotate>
                        <I d={P.refresh} />
                      </button>
                      <ZoomSlider crop={photo} setCrop={setPhoto} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <button type="button" className="btn" style={{ background: "transparent", color: "#fff", borderColor: "#3a3a3a", height: 46 }} onClick={() => (setCropOpen(false), setPhoto(null), setTab(savedPhoto ? "photo" : "icon"))}>
                        {x.cancel}
                      </button>
                      <button type="button" className="btn" style={{ background: "#fff", color: "#111", borderColor: "#fff", height: 46, fontWeight: 600 }} onClick={() => setCropOpen(false)} data-identity-use>
                        {x.usePhoto}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </D.Content>
          )}
        </div>
      </D.Portal>
    </D.Root>
  );
}

function DropZone({ onFile, onChoose }: { onFile: (f: File) => void; onChoose: () => void }) {
  const { t } = useI18n();
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const fl = e.dataTransfer.files?.[0];
        if (fl) onFile(fl);
      }}
      style={{ border: `1.5px dashed ${over ? "var(--ink)" : "var(--line-strong)"}`, borderRadius: 14, background: "var(--s)", minHeight: 290, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, textAlign: "center", padding: 20 }}
      data-identity-drop
    >
      <span className="ic" style={{ width: 52, height: 52, borderRadius: 14 }}>
        <I d={P.picture} size="lg" />
      </span>
      <b>{t.ident.drop}</b>
      <span className="tiny">{t.ident.types}</span>
      <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={onChoose} data-identity-choose>
        {t.ident.choose}
      </button>
    </div>
  );
}

function ZoomSlider({ crop, setCrop }: { crop: Crop; setCrop: (c: Crop) => void }) {
  const { t } = useI18n();
  return (
    <input
      type="range"
      min={100}
      max={400}
      step={1}
      value={Math.round(crop.zoom * 100)}
      aria-label={t.ident.zoom}
      onChange={(e) => setCrop(clamp({ ...crop, zoom: Number(e.target.value) / 100 }))}
      style={{ flex: 1, accentColor: "currentColor" }}
      data-identity-zoom
    />
  );
}

/**
 * The crop stage: the image (CSS transform, GPU only) behind a rounded-square frame. Drag with one pointer, pinch with
 * two, wheel to zoom; arrow keys move, +/- zoom. Everything in frame pixels; export uses the same numbers.
 */
function Cropper({ crop, setCrop, frame, box, dark }: { crop: Crop; setCrop: (c: Crop) => void; frame: number; box: number; dark?: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ x: number; y: number; d: number } | null>(null);
  const cur = useRef(crop);
  useEffect(() => {
    cur.current = crop;
  });
  const set = (c: Crop) => setCrop(clamp(c));
  const s = coverScale(crop) * crop.zoom * frame;
  const src = crop.img instanceof HTMLImageElement ? crop.img.src : null;
  // An ImageBitmap is drawn into a canvas once (no URL needed).
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (src || !canvas.current) return;
    const c = canvas.current;
    c.width = crop.w;
    c.height = crop.h;
    c.getContext("2d")?.drawImage(crop.img, 0, 0);
  }, [crop.img, crop.w, crop.h, src]);
  const media = { position: "absolute" as const, left: "50%", top: "50%", width: crop.w, height: crop.h, transformOrigin: "center", transform: `translate(-50%,-50%) translate(${crop.x * frame}px, ${crop.y * frame}px) rotate(${crop.rot}deg) scale(${s})`, willChange: "transform", pointerEvents: "none" as const, maxWidth: "none" };
  const r = Math.round(frame * 0.22);
  return (
    <div
      ref={ref}
      tabIndex={0}
      role="application"
      aria-label={t.ident.dragToMove}
      style={{ position: "relative", width: box, height: box, overflow: "hidden", borderRadius: dark ? 0 : 14, background: dark ? "#0b0b0b" : "#2a2622", touchAction: "none", cursor: "grab", flexShrink: 0, outline: "none" }}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        last.current = null;
      }}
      onPointerMove={(e) => {
        if (!pts.current.has(e.pointerId)) return;
        pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const p = [...pts.current.values()];
        const cx = p.reduce((a, b) => a + b.x, 0) / p.length;
        const cy = p.reduce((a, b) => a + b.y, 0) / p.length;
        const d = p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0;
        const l = last.current;
        last.current = { x: cx, y: cy, d };
        if (!l) return;
        const c = cur.current;
        const zoom = l.d && d ? Math.max(1, Math.min(4, c.zoom * (d / l.d))) : c.zoom;
        set({ ...c, zoom, x: c.x + (cx - l.x) / frame, y: c.y + (cy - l.y) / frame });
      }}
      onPointerUp={(e) => {
        pts.current.delete(e.pointerId);
        last.current = null;
      }}
      onPointerCancel={(e) => {
        pts.current.delete(e.pointerId);
        last.current = null;
      }}
      onWheel={(e) => {
        const c = cur.current;
        set({ ...c, zoom: Math.max(1, Math.min(4, c.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))) });
      }}
      onKeyDown={(e) => {
        const c = cur.current;
        const k = { ArrowLeft: [-0.04, 0], ArrowRight: [0.04, 0], ArrowUp: [0, -0.04], ArrowDown: [0, 0.04] }[e.key];
        if (k) {
          e.preventDefault();
          set({ ...c, x: c.x + k[0], y: c.y + k[1] });
        } else if (e.key === "+" || e.key === "=") set({ ...c, zoom: Math.min(4, c.zoom * 1.1) });
        else if (e.key === "-") set({ ...c, zoom: Math.max(1, c.zoom / 1.1) });
      }}
      data-identity-cropper
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local object URL being cropped
        <img src={src} alt="" style={media} draggable={false} />
      ) : (
        <canvas ref={canvas} style={media} />
      )}
      {/* Dim outside the frame; the frame + thirds grid. */}
      <div style={{ position: "absolute", left: (box - frame) / 2, top: (box - frame) / 2, width: frame, height: frame, borderRadius: r, boxShadow: `0 0 0 9999px rgba(0,0,0,${dark ? 0.6 : 0.45})`, border: "2px solid #fff", pointerEvents: "none", backgroundImage: "linear-gradient(rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.35) 1px, transparent 1px)", backgroundSize: `${frame / 3}px ${frame / 3}px`, backgroundPosition: "-1px -1px" }} />
    </div>
  );
}
