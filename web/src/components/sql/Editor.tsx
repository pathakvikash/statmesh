"use client";
import { autocompletion, closeBrackets, completionKeymap, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { StandardSQL, sql } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { valueCompletions } from "@/lib/sql";
import type { SqlSchema } from "@/lib/sql-schema";

export type EditorApi = { insert(text: string): void; set(text: string): void; get(): string };

// Colours come from the theme tokens, so light/dark follows the page with no extra wiring.
const theme = EditorView.theme({
  "&": { backgroundColor: "var(--color-card)", color: "var(--color-foreground)", fontSize: "13px", minHeight: "9rem" },
  ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--color-accent)", padding: "8px 0", outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--color-accent)" },
  "&.cm-focused": { outline: "2px solid var(--color-accent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "color-mix(in oklab, var(--color-accent) 25%, transparent)" },
  ".cm-tooltip": { backgroundColor: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-foreground)" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--color-accent)", color: "var(--color-accent-foreground)" },
  ".cm-placeholder": { color: "var(--color-muted-foreground)" },
});
const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--color-chart-1)", fontWeight: "600" },
  { tag: [t.string, t.special(t.string)], color: "var(--color-chart-5)" },
  { tag: [t.number, t.bool, t.null], color: "var(--color-chart-4)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--color-muted-foreground)", fontStyle: "italic" },
  { tag: [t.typeName, t.standard(t.name)], color: "var(--color-chart-2)" },
]);

/** CodeMirror 6 with schema-aware completion. Loaded with next/dynamic (ssr: false), only on /sql. */
export default function Editor({ schema, sources = [], initial, onRun, onChange, apiRef }: {
  schema: SqlSchema; sources?: string[]; initial: string; onRun: () => void; onChange: (s: string) => void; apiRef: { current: EditorApi | null };
}) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef({ onRun, onChange });
  useEffect(() => { cb.current = { onRun, onChange }; });

  useEffect(() => {
    const spec = Object.fromEntries(schema.views.map((v) => [v.name, v.columns.map((c) => c.name)]));
    // Source ids after `source_id = '` or inside `source_id IN ('`; the schema completion handles tables and columns.
    const values = (ctx: CompletionContext) => {
      const start = Math.max(0, ctx.pos - 300);
      const r = valueCompletions(ctx.state.sliceDoc(start, ctx.pos), sources);
      return r && { from: start + r.from, options: r.options.map((label) => ({ label, type: "constant" })), validFor: /^[\w.-]*$/ };
    };
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(), closeBrackets(), autocompletion(), EditorView.lineWrapping, theme, syntaxHighlighting(highlight),
          sql({ dialect: StandardSQL, schema: spec, upperCaseKeywords: true }),
          StandardSQL.language.data.of({ autocomplete: values }),
          placeholder("SELECT ... FROM observations WHERE ...   or describe what you want in plain words"),
          keymap.of([{ key: "Mod-Enter", run: () => (cb.current.onRun(), true) }, ...completionKeymap, ...historyKeymap, ...defaultKeymap]),
          EditorView.updateListener.of((u) => u.docChanged && cb.current.onChange(u.state.doc.toString())),
          EditorView.contentAttributes.of({ "aria-label": "SQL query" }),
        ],
      }),
    });
    apiRef.current = {
      get: () => view.state.doc.toString(),
      set: (text) => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); view.focus(); },
      insert: (text) => { view.dispatch(view.state.replaceSelection(text)); view.focus(); },
    };
    return () => { view.destroy(); apiRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  return <div ref={host} className="overflow-hidden rounded-xl border border-border" />;
}
