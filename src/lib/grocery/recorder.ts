// R18 S4 C1 — voice add records the person (MediaRecorder: opus / webm, mp4 on iPhones) up to 60 s and the AI reads the
// audio (`/api/grocery/voice`); the browser's own speech recognition only shows live words when it works. A level meter
// comes from the recording's own audio (Web Audio analyser). The recording is converted to a 16 kHz mono WAV before it
// is sent (every model reads WAV; a minute is ~1.9 MB), the original when the browser can't decode it. Client only.

export const VOICE_MAX_MS = 60_000;

/** The recorder's formats, best first (opus in webm / ogg; AAC in mp4 for Safari). */
const MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"];

export function pickMime(isType: (m: string) => boolean): string {
  return MIMES.find((m) => {
    try {
      return isType(m);
    } catch {
      return false;
    }
  }) ?? "";
}

export const recorderSupported = () => typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

export type RecError = "blocked" | "nomic" | "failed";
export type Recording = {
  /** 0…1, the loudness right now (for the meter). */
  level: () => number;
  /** Finish: the audio and how long it was. */
  stop: () => Promise<{ blob: Blob; ms: number }>;
  cancel: () => void;
  startedAt: number;
};

export function recError(e: unknown): RecError {
  const n = (e as DOMException)?.name;
  return n === "NotAllowedError" || n === "SecurityError" ? "blocked" : n === "NotFoundError" || n === "OverconstrainedError" ? "nomic" : "failed";
}

/** Start recording now. Stops by itself at 60 s (`onLimit`). Throws a DOMException when the mic can't be had. */
export async function startRecording(onLimit?: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const mime = pickMime((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  // The level meter: an analyser on the same stream.
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  try {
    ctx = new AudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
  } catch {}
  const buf = new Uint8Array(512);
  const startedAt = performance.now();
  rec.start(250);
  const done = () => {
    stream.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => {});
  };
  const limit = setTimeout(() => onLimit?.(), VOICE_MAX_MS);
  return {
    startedAt,
    level: () => {
      if (!analyser) return 0;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      return Math.min(1, Math.sqrt(sum / buf.length) * 4);
    },
    stop: () =>
      new Promise((resolve) => {
        clearTimeout(limit);
        const ms = Math.min(VOICE_MAX_MS, performance.now() - startedAt);
        rec.onstop = () => {
          done();
          resolve({ blob: new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }), ms });
        };
        if (rec.state === "inactive") rec.onstop(new Event("stop"));
        else rec.stop();
      }),
    cancel: () => {
      clearTimeout(limit);
      try {
        rec.stop();
      } catch {}
      done();
    },
  };
}

/** 16 kHz mono 16-bit WAV of a recording (null when the browser can't decode it — the original goes then). */
export async function toWav(blob: Blob, rate = 16_000): Promise<Blob | null> {
  try {
    const raw = await blob.arrayBuffer();
    const ac = new AudioContext();
    const audio = await ac.decodeAudioData(raw.slice(0));
    void ac.close().catch(() => {});
    const len = Math.min(Math.ceil(audio.duration * rate), (VOICE_MAX_MS / 1000) * rate);
    const off = new OfflineAudioContext(1, len, rate);
    const src = off.createBufferSource();
    src.buffer = audio;
    src.connect(off.destination);
    src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF");
    out.setUint32(4, 36 + pcm.length * 2, true);
    str(8, "WAVE");
    str(12, "fmt ");
    out.setUint32(16, 16, true);
    out.setUint16(20, 1, true);
    out.setUint16(22, 1, true);
    out.setUint32(24, rate, true);
    out.setUint32(28, rate * 2, true);
    out.setUint16(32, 2, true);
    out.setUint16(34, 16, true);
    str(36, "data");
    out.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
    return new Blob([out.buffer], { type: "audio/wav" });
  } catch {
    return null;
  }
}

/** The model's items as lines the Paste review reads ("2 milk", "0.5 kg tomatoes"). Pure (the test runs it). */
export function itemLines(items: { name: string; qty?: number | null; amount?: number | null; unit?: string | null }[]): string[] {
  const out: string[] = [];
  for (const i of items) {
    const name = String(i.name ?? "").trim().slice(0, 120);
    if (!name) continue;
    const unit = i.unit === "kg" || i.unit === "g" ? i.unit : i.unit === "l" || i.unit === "L" ? "l" : null;
    if (unit && i.amount != null && i.amount > 0) out.push(`${Math.round(i.amount * 1000) / 1000} ${unit} ${name}`);
    else if (i.qty != null && i.qty > 1) out.push(`${Math.min(99, Math.round(i.qty))} ${name}`);
    else out.push(name);
  }
  return out.slice(0, 60);
}
