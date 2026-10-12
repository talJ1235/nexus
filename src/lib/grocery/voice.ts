// R18 C4 — voice capture for the supermarket Add field (client only): the browser's Web Speech API in he-IL / en-US.
// No support (Firefox, some WebViews) → { supported: false } and S2 hides the mic. The transcript goes to splitList.

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecCtor = new () => Rec;

function ctor(): RecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const voiceSupported = () => ctor() != null;

export type VoiceSession = { supported: true; stop: () => void; abort: () => void } | { supported: false };

/**
 * Listen once. `onText(text, final)` gets the transcript so far (interim) and the final one; `onEnd(error?)` when it
 * stops (error = "not-allowed" / "no-speech" / "network"…).
 */
export function listen(locale: "he" | "en", onText: (text: string, final: boolean) => void, onEnd: (error?: string) => void): VoiceSession {
  const C = ctor();
  if (!C) return { supported: false };
  const r = new C();
  r.lang = locale === "he" ? "he-IL" : "en-US";
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  let finalText = "";
  let failed: string | undefined;
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    onText((finalText + interim).trim(), !interim);
  };
  r.onerror = (e) => {
    failed = e.error;
  };
  r.onend = () => onEnd(failed);
  try {
    r.start();
  } catch {
    return { supported: false };
  }
  return { supported: true, stop: () => r.stop(), abort: () => r.abort() };
}
