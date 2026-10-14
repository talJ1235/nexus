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
 * The transcript so far from every result (not only from `resultIndex`): Android Chrome re-sends earlier finals —
 * sometimes each final repeats the whole phrase so far — so a final already contained in the text isn't added twice,
 * and one that extends it replaces it. Interim text follows the finals. Exported for the test.
 */
export function transcriptOf(results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>): { text: string; final: string } {
  let final = "";
  let interim = "";
  for (let i = 0; i < results.length; i++) {
    const t = (results[i][0]?.transcript ?? "").trim();
    if (!t) continue;
    if (!results[i].isFinal) {
      interim = interim ? `${interim} ${t}` : t;
      continue;
    }
    if (!final || t.startsWith(final)) final = t;
    else if (!final.includes(t)) final = `${final} ${t}`;
  }
  return { text: [final, interim].filter(Boolean).join(" ").trim(), final };
}

/**
 * R18 S3 B5: listen until Stop (continuous — a pause between products doesn't end it). `onText(text)` shows the
 * transcript so far; `onEnd(text, error?)` once, when listening has really ended (after Stop, the browser's own end
 * after silence, or an error) with the best transcript — the final words often arrive just after Stop, so callers wait
 * for this instead of reading the screen. error = "not-allowed" / "no-speech" / "network"… ("aborted" isn't one).
 */
export function listen(locale: "he" | "en", onText: (text: string) => void, onEnd: (text: string, error?: string) => void): VoiceSession {
  const C = ctor();
  if (!C) return { supported: false };
  const r = new C();
  r.lang = locale === "he" ? "he-IL" : "en-US";
  r.interimResults = true;
  r.continuous = true;
  r.maxAlternatives = 1;
  let text = "";
  let failed: string | undefined;
  let ended = false;
  r.onresult = (e) => {
    text = transcriptOf(e.results).text;
    onText(text);
  };
  r.onerror = (e) => {
    if (e.error !== "aborted") failed = e.error;
  };
  r.onend = () => {
    if (ended) return;
    ended = true;
    onEnd(text, text ? undefined : failed);
  };
  try {
    r.start();
  } catch {
    return { supported: false };
  }
  return {
    supported: true,
    stop: () => r.stop(),
    abort: () => {
      ended = true;
      r.abort();
    },
  };
}
