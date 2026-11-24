"use client";
/**
 * Worker replies as Markdown (GitHub flavour: tables, numbered lists, links, code, strikethrough),
 * plus glass cards the model can ask for:
 *
 *   ```card                 one card
 *   ### Result
 *   Imported **14 invoices** into Q3 Expenses.
 *   ```
 *
 *   ```cards                several cards side by side, separated by ---
 *   tone: green             optional first line: green, blue, amber, red
 *   ### Paid
 *   **12** invoices
 *   ---
 *   ### Overdue
 *   **2** invoices
 *   ```
 *
 * A quote whose first line is bold ("> **Result**") is also a card, as in the older format.
 */
import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const TONES = new Set(["green", "blue", "amber", "red"]);

type Card = { tone?: string; body: string };

/** Splits a card block into cards. Exported for tests. */
export function parseCards(source: string, many: boolean): Card[] {
  const parts = many ? source.split(/^\s*---\s*$/m) : [source];
  return parts
    .map((part) => {
      const tone = part.match(/^\s*tone:\s*(\w+)\s*$/im);
      const body = part.replace(/^\s*tone:\s*\w+\s*$/im, "").trim();
      return { tone: tone && TONES.has(tone[1].toLowerCase()) ? tone[1].toLowerCase() : undefined, body };
    })
    .filter((card) => card.body);
}

const textOf = (node: any): string =>
  !node ? "" : node.type === "text" ? node.value : (node.children || []).map(textOf).join("");

function GlassCards({ source, many }: { source: string; many: boolean }) {
  const cards = parseCards(source, many);
  if (!cards.length) return null;
  const list = cards.map((card, i) => (
    <div key={i} className={`wk-r-card${card.tone ? ` is-${card.tone}` : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={cardComponents}>{card.body}</ReactMarkdown>
    </div>
  ));
  return many ? <div className="wk-r-cards">{list}</div> : list[0];
}

const link: Components["a"] = ({ node: _node, href, children, ...rest }) => (
  <a {...rest} href={href} target="_blank" rel="noopener noreferrer">{children}</a>
);

const table: Components["table"] = ({ node: _node, children, ...rest }) => (
  <div className="wk-r-table"><table {...rest}>{children}</table></div>
);

/** Inside a card: headings become the card title. */
const cardComponents: Components = {
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h3>{children}</h3>,
  h3: ({ children }) => <h3>{children}</h3>,
  a: link,
  table,
};

const components: Components = {
  h1: ({ children }) => <h1 className="wk-r-title">{children}</h1>,
  h2: ({ children }) => <h2>{children}</h2>,
  h3: ({ children }) => <h3 className="wk-r-sub">{children}</h3>,
  h4: ({ children }) => <h3 className="wk-r-sub">{children}</h3>,
  a: link,
  table,
  pre: ({ node, children }) => {
    const code: any = node?.children?.[0];
    const classes: string[] = code?.properties?.className || [];
    const lang = classes.find((c) => String(c).startsWith("language-"))?.slice(9);
    if (lang === "card" || lang === "cards") return <GlassCards source={textOf(code)} many={lang === "cards"} />;
    return <pre className="wk-r-code">{children}</pre>;
  },
  blockquote: ({ node, children }) => {
    // "> **Heading**" + text: a callout card.
    const first: any = (node?.children || []).find((c: any) => c.type === "element");
    const strong: any = first?.tagName === "p" ? first.children?.[0] : null;
    const isCallout = strong?.type === "element" && strong.tagName === "strong";
    // The leading bold line is styled as the card title (see .wk-r-card.is-callout).
    return isCallout
      ? <div className="wk-r-card is-callout">{children}</div>
      : <blockquote className="wk-r-quote">{children}</blockquote>;
  },
};

export function ReplyMarkdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>;
}
