// On-device assistant helpers (provider kind "browser"). Pure and SSR-safe: no web-llm import here, the library
// loads only after the visitor opts in (components/ai/browser-engine.ts). Retrieval-first: no tool calling.
import type { ProviderConfig, ProviderKind } from "./providers";

export const BROWSER_KIND = "browser" as ProviderKind;
export const isBrowser = (kind: string) => kind === "browser";
export const BROWSER_LABEL = "On-device (WebGPU)";
export const BROWSER_CONFIG: ProviderConfig = { kind: BROWSER_KIND, baseUrl: "", model: "", apiKey: "" };

/** Ids and sizes come from `prebuiltAppConfig.model_list` of @mlc-ai/web-llm 0.2.88 (vram_required_MB). */
export const BROWSER_MODELS = [
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 1.5B (small, default)", gb: 1.6,
    rev: "9bd564b064631febf14deadcac492efb761d60c3",
    integrity: { config: "sha256-faSVQhLT8hqRzD5pPRefYyE/1XNWeWhH9l1/lUeKH54=", model_lib: "sha256-FV73NZyFn31kb0xa3FSNd5R12j4xlnAcep1LgoJ1Wag=", tokenizer: { "tokenizer.json": "sha256-wDghF+oynN8JcEETL21zWSS2l5JNb2/DlFcT6WzodTk=" } } },
  { id: "Qwen2.5-7B-Instruct-q4f16_1-MLC", label: "Qwen2.5 7B (larger, better answers)", gb: 5.1,
    rev: "691c5f2512745eeae9607266e7df43e67339f403",
    integrity: { config: "sha256-WXABe7dNHttrXAFIE/DBcgM8mZtih1HEwi6PF/jMhMA=", model_lib: "sha256-7x4D3gSqe9BIbum1OR2QIbDyMNemxO+Wps2CLuvs3Sg=", tokenizer: { "tokenizer.json": "sha256-wDghF+oynN8JcEETL21zWSS2l5JNb2/DlFcT6WzodTk=" } } },
] as const;
export const DEFAULT_BROWSER_MODEL: string = BROWSER_MODELS[0].id;
export const browserModel = (id: string) => BROWSER_MODELS.find((m) => m.id === id) ?? BROWSER_MODELS[0];

export const browserNote = (gb: number) =>
  `Runs on your device. First use downloads about ${gb} GB (cached afterwards). Nothing you type leaves your browser except the catalogue search for your question. Small model: can make mistakes, check the cited sources.`;

/** WebGPU gate. Takes the navigator so it is testable and safe on the server (undefined => false). */
export const hasWebGPU = (nav?: { gpu?: unknown }) => !!nav && !!nav.gpu;

/** One retrieved series, as returned by GET /api/chat/context. */
export type Fact = {
  id: string; title: string; source: string; url: string;
  value: number | null; unit: string | null; period: string | null; geo: string | null;
  /** Many-country series with no single value: the highest countries at `period`, and the computed median over `count` countries. */
  top?: { geo: string; v: number }[]; median?: { value: number; count: number };
};

export const REFUSAL = "I don't have data for that";

export function buildMessages(question: string, facts: Fact[]): { role: "system" | "user"; content: string }[] {
  const lines = facts.map((f, i) =>
    `[${i + 1}] id=${f.id} | ${f.title}${f.geo ? ` | geo ${f.geo}` : ""} | source ${f.source} | latest value ${f.value ?? "n/a"}${f.unit ? ` ${f.unit}` : ""}${f.period ? ` (period ${f.period})` : ""}${f.median ? ` | median of ${f.median.count} countries (computed) ${f.median.value}` : ""}${f.top?.length ? ` | highest countries: ${f.top.map((t) => `${t.geo} ${t.v}`).join(", ")}` : ""}`);
  return [
    {
      role: "system",
      content: [
        "You are a statistics assistant. Answer ONLY from the FACTS below.",
        `If the facts do not contain the answer, reply exactly: "${REFUSAL}."`,
        "Never invent numbers and never use numbers from memory. Copy numbers exactly as given in the facts.",
        "Cite the series id and source in brackets for every number, like [id, source]. Be brief.",
        "",
        "FACTS:",
        lines.length ? lines.join("\n") : "(none)",
      ].join("\n"),
    },
    { role: "user", content: question },
  ];
}

// ---- answer assembly ---------------------------------------------------------------------------------
// Numbers are checked by the shared lib/chat/flag.ts in the UI: the facts are pushed as a `result` event (factsEvent).
import type { ChatEvent } from "./events";

/** The retrieved facts as a tool-result event, so Answer/Markdown flag numbers against them like for any provider. */
export const factsEvent = (facts: Fact[]): ChatEvent => ({ t: "result", id: "facts", name: "search", output: facts });

const esc = (t: string) => t.replace(/([\\[\]()])/g, "\\$1");

/** Markdown "Sources" block from the retrieved facts (catalogue titles are escaped so they cannot break the link syntax). */
export const sourcesBlock = (facts: Fact[]): string =>
  facts.length ? `\n\n**Sources**\n${facts.map((f) => `- [${esc(f.id)}](${f.url}): ${esc(f.title)}, ${esc(f.source)}${f.period ? `, ${f.period}` : ""}`).join("\n")}` : "";

/** Final text: the answer plus Sources, except on a refusal (no data, so nothing to cite). */
export const finalizeAnswer = (answer: string, facts: Fact[]) =>
  answer.trim().startsWith(REFUSAL) ? answer : answer + sourcesBlock(facts);

/** Retrieval query: the newest question first, then the previous user turn (follow-ups like "and 2020?"), capped at 200 chars. */
export const retrievalQuery = (userTurns: string[]): string => userTurns.slice(-2).reverse().join(" ").replace(/\s+/g, " ").trim().slice(0, 200);

// ---- client -> /api/chat/context ----------------------------------------------------------------------
export async function fetchFacts(q: string, signal?: AbortSignal): Promise<Fact[]> {
  const r = await fetch(`/api/chat/context?q=${encodeURIComponent(q.slice(0, 200))}`, { signal });
  if (!r.ok) throw new Error(r.status === 429 ? "Too many questions, try again in a minute." : "Could not search the catalogue.");
  const j = await r.json();
  return Array.isArray(j?.facts) ? j.facts : [];
}

// ---- suggestions: built from the retrieved facts only (no model call, nothing invented) ----------------
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumSignificantDigits: 4 });
const short = (t: string) => (t.length > 70 ? `${t.slice(0, 67)}...` : t);

/** A "Did you know" line from the first fact with a value, and follow-up questions that the catalogue can answer. */
export function suggestions(facts: Fact[]): { fact: string | null; questions: string[] } {
  const f = facts.find((x) => x.value !== null || x.top?.length);
  if (!f) return { fact: null, questions: [] };
  const unit = f.unit ? ` ${f.unit}` : "";
  const when = f.period ? ` (${f.period.slice(0, 4)})` : "";
  const fact = f.value !== null
    ? `${short(f.title)}: ${compact.format(f.value)}${unit}${f.geo ? ` in ${f.geo}` : ""}${when}. Source: ${f.source}.`
    : `${short(f.title)}${when}: highest is ${f.top!.slice(0, 3).map((t) => `${t.geo} (${compact.format(t.v)})`).join(", ")}${f.unit ? `, in ${f.unit}` : ""}. Source: ${f.source}.`;
  const t = short(f.title);
  const questions = [
    `How has ${t} changed over time?`,
    f.top?.length ? `Which countries have the lowest ${t}?` : `Compare ${t} across countries`,
    ...(facts.length > 1 ? [`How does ${short(facts[1].title)} compare?`] : []),
  ];
  return { fact, questions: questions.slice(0, 3) };
}
