import { createElement, Fragment, ReactNode } from "react";

/**
 * A small, dependency-free Markdown renderer for the desktop UI. It covers the
 * subset the agent actually emits — headings, bold/italic, inline code, fenced
 * and indented code, ordered/unordered lists, blockquotes, links, rules — and
 * degrades to plain paragraphs for anything else. No external parser is pulled
 * in, so it stays inside the renderer's strict offline/CSP boundary.
 *
 * Links open in the OS browser via the main process' window-open handler (any
 * https navigation is delegated to shell.openExternal), so `target=_blank` is
 * safe here.
 */

type InlineToken = string | ReactNode;

/** Parse inline spans: `code`, **bold**, *italic*, [text](url). */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Order matters: code first (its content must not be re-parsed), then links,
  // then bold, then italic. A single regex alternation keeps positions aligned.
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*]+\*|_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const [token] = match;
    const key = `${keyPrefix}-i${i++}`;
    if (token.startsWith("`")) {
      nodes.push(<code key={key} className="md-code">{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    } else if (token.startsWith("[")) {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (m) nodes.push(<a key={key} href={m[2]} target="_blank" rel="noreferrer">{m[1]}</a>);
      else nodes.push(token);
    } else {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes as InlineToken[];
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "code"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "hr" }
  | { kind: "p"; text: string };

/** Split source into block-level chunks. */
function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }
    // Fenced code
    if (line.trimStart().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) { body.push(lines[i]); i++; }
      i++; // closing fence
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    // Heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) { blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() }); i++; continue; }
    // Horizontal rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ kind: "hr" }); i++; continue; }
    // Blockquote (consume consecutive > lines)
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { body.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      blocks.push({ kind: "quote", text: body.join("\n") });
      continue;
    }
    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, "")); i++; }
      blocks.push({ kind: "ul", items });
      continue;
    }
    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, "")); i++; }
      blocks.push({ kind: "ol", items });
      continue;
    }
    // Paragraph: gather until a blank line or a new block starter.
    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() !== "" &&
      !/^(#{1,6})\s|^\s*>|^\s*[-*+]\s+|^\s*\d+[.)]\s+|^\s*```/.test(lines[i])
    ) { para.push(lines[i]); i++; }
    blocks.push({ kind: "p", text: para.join("\n") });
  }
  return blocks;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text ?? "");
  return (
    <div className={`md ${className ?? ""}`}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.kind) {
          case "heading":
            return createElement(`h${Math.min(block.level, 6)}`, { key }, renderInline(block.text, key));
          case "code":
            return <pre key={key} className="md-pre"><code>{block.text}</code></pre>;
          case "ul":
            return <ul key={key}>{block.items.map((it, j) => <li key={j}>{renderInline(it, `${key}-${j}`)}</li>)}</ul>;
          case "ol":
            return <ol key={key}>{block.items.map((it, j) => <li key={j}>{renderInline(it, `${key}-${j}`)}</li>)}</ol>;
          case "quote":
            return <blockquote key={key}>{renderInline(block.text, key)}</blockquote>;
          case "hr":
            return <hr key={key} />;
          default:
            return (
              <p key={key}>
                {block.text.split("\n").map((ln, j, arr) => (
                  <Fragment key={j}>{renderInline(ln, `${key}-${j}`)}{j < arr.length - 1 ? <br /> : null}</Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
