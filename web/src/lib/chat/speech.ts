// Pure parts of voice input; the browser glue is in useSpeech.ts.
export type SpeechState = { status: "idle" | "listening" | "error"; error?: string };
export type SpeechAction = { type: "start" } | { type: "end" } | { type: "error"; code: string };

const MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access was denied. Allow it in your browser settings.",
  "service-not-allowed": "Speech recognition is blocked in this browser.",
  "no-speech": "No speech heard. Try again.",
  "audio-capture": "No microphone found.",
  network: "Could not reach the speech service (network error).",
};
export const speechErrorMessage = (code: string) => MESSAGES[code] ?? `Speech recognition failed (${code}).`;

export function speechReducer(s: SpeechState, a: SpeechAction): SpeechState {
  switch (a.type) {
    case "start":
      return { status: "listening" };
    case "end": // an error keeps its message until the next start; "end" always follows "error" in browsers
      return s.status === "error" ? s : { status: "idle" };
    case "error":
      return a.code === "aborted" ? s : { status: "error", error: speechErrorMessage(a.code) };
  }
}

/** Text typed before dictation + finalised phrases + the current interim phrase, single-space joined. */
export const mergeTranscript = (base: string, finals: string, interim = ""): string =>
  [base.trimEnd(), finals.trim(), interim.trim()].filter(Boolean).join(" ");

export const statusText = (s: SpeechState) =>
  s.status === "listening" ? "Listening" : s.status === "error" ? (s.error ?? "") : "";
