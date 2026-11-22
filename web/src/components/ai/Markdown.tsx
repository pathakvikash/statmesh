"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { flagUnsourcedNumbers } from "@/lib/chat/flag";
import { pageSlice } from "@/lib/chat/details";
import { Pager } from "./Pager";

type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] };

/** Body rows of the table being rendered and the visible page, so each <tr> can hide itself. */
const TableCtx = createContext<{ rows: unknown[]; start: number; size: number } | null>(null);

/** A GFM table: scrolls sideways, sticky header, 5 rows a page when there are more than 5. Cell formatting and flags are kept. */
function MdTable({ node, children }: { node?: Node; children?: ReactNode }) {
  const [page, setPage] = useState(0);
  const body = node?.children?.find((c) => c.tagName === "tbody");
  const rows = (body?.children ?? []).filter((c) => c.type === "element" && c.tagName === "tr");
  const s = pageSlice(rows.length, page);
  return (
    <div>
      <div className="max-h-80 overflow-auto rounded-lg border border-border">
        <TableCtx.Provider value={{ rows, start: s.start, size: 5 }}>
          <table className="w-full border-collapse text-sm [&_th]:sticky [&_th]:top-0">{children}</table>
        </TableCtx.Provider>
      </div>
      <Pager total={rows.length} page={s.page} onPage={setPage} />
    </div>
  );
}

function MdRow({ node, children }: { node?: Node; children?: ReactNode }) {
  const ctx = useContext(TableCtx);
  const i = ctx && node ? ctx.rows.indexOf(node) : -1;
  if (ctx && i >= 0 && rowsPaged(ctx.rows.length) && (i < ctx.start || i >= ctx.start + ctx.size)) return null;
  return <tr className="odd:bg-muted/40">{children}</tr>;
}
const rowsPaged = (n: number) => n > 5;

const INLINE = new Set(["strong", "em", "a", "del", "mark"]);

/**
 * rehype plugin: wraps numbers that appear in no tool result in <mark>, skipping code. Each block's text is
 * checked as a whole ("**3.2** billion" is one number), then the marks are cut back into the text nodes.
 */
function flagNumbers(results: unknown[], userText: string) {
  const block = (n: Node) => {
    if (n.tagName === "code" || n.tagName === "pre" || !n.children) return;
    const texts: { t: Node; parent: Node; at: number }[] = [];
    let flat = "";
    const collect = (m: Node) => {
      for (const c of m.children ?? []) {
        if (c.type === "text" && c.value) (texts.push({ t: c, parent: m, at: flat.length }), (flat += c.value));
        else if (c.type === "element" && INLINE.has(c.tagName!)) collect(c);
      }
    };
    collect(n);
    const flags = flat ? flagUnsourcedNumbers(flat, results, userText) : [];
    for (const { t, parent, at } of texts) {
      const v = t.value!;
      const out: Node[] = [];
      let from = 0;
      for (const f of flags) {
        const a = Math.max(f.start - at, from), b = Math.min(f.end - at, v.length);
        if (b <= a) continue;
        if (a > from) out.push({ type: "text", value: v.slice(from, a) });
        out.push({ type: "element", tagName: "mark", properties: { title: "Not found in any tool result" }, children: [{ type: "text", value: v.slice(a, b) }] });
        from = b;
      }
      if (!out.length) continue;
      if (from < v.length) out.push({ type: "text", value: v.slice(from) });
      parent.children = parent.children!.flatMap((c) => (c === t ? out : [c]));
    }
    for (const c of n.children) if (c.type === "element" && !INLINE.has(c.tagName!)) block(c);
  };
  return () => (tree: Node) => block(tree);
}

/**
 * Assistant text as Markdown. No raw HTML (react-markdown drops it), unsafe URL schemes are stripped by its
 * default urlTransform, links open in a new tab with rel noopener.
 */
export function Markdown({ text, results, userText }: { text: string; results: unknown[]; userText: string }) {
  return (
    <div className="space-y-3 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={["img"]}
        rehypePlugins={[flagNumbers(results, userText)]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline">{children}</a>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          h1: ({ children }) => <h3 className="font-semibold">{children}</h3>,
          h2: ({ children }) => <h3 className="font-semibold">{children}</h3>,
          h3: ({ children }) => <h3 className="font-semibold">{children}</h3>,
          h4: ({ children }) => <h3 className="font-semibold">{children}</h3>,
          h5: ({ children }) => <h3 className="font-semibold">{children}</h3>,
          h6: ({ children }) => <h3 className="font-semibold">{children}</h3>,
          // Images are never loaded: a URL with the user's data in it would be fetched on render.
          img: () => null,
          code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
          pre: ({ children }) => <pre className="overflow-x-auto rounded-lg bg-muted p-2 text-xs [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
          table: MdTable as never,
          tr: MdRow as never,
          th: ({ children }) => <th className="whitespace-nowrap border-b border-border bg-muted px-2 py-1 text-left font-medium">{children}</th>,
          td: ({ children }) => <td className="px-2 py-1 tabular-nums">{children}</td>,
          mark: ({ children, title }) => <mark className="rounded bg-accent/25 px-0.5 text-foreground underline decoration-accent decoration-dotted" title={title}>{children}</mark>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
