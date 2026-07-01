import matter from "gray-matter";
import type { MarkdownHeading, MarkdownSnapshot } from "../domain/vault.js";

export function parseMarkdownSnapshot(filePath: string, content: string): MarkdownSnapshot {
  const parsed = matter(content);
  const body = parsed.content.trim();
  const lines = body.split(/\r?\n/);
  const headings = extractHeadings(lines);
  const title = getTitle(parsed.data, headings, filePath);
  const wordCount = countWords(body);

  return {
    filePath,
    title,
    headings,
    excerpt: buildExcerpt(body),
    frontmatter: parsed.data,
    lineCount: lines.length,
    wordCount,
  };
}

function extractHeadings(lines: string[]): MarkdownHeading[] {
  return lines.flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) return [];

    return [{ level: match[1].length, text: match[2].trim(), line: index + 1 }];
  });
}

function getTitle(
  frontmatter: Record<string, unknown>,
  headings: MarkdownHeading[],
  filePath: string,
): string {
  const frontmatterTitle = frontmatter.title;
  if (typeof frontmatterTitle === "string" && frontmatterTitle.trim().length > 0) {
    return frontmatterTitle.trim();
  }

  const firstHeading = headings[0]?.text;
  if (firstHeading) return firstHeading;

  return filePath.split("/").at(-1)?.replace(/\.md$/i, "") ?? filePath;
}

function buildExcerpt(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 800);
}

function countWords(body: string): number {
  const asciiWords = body.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  const cjkChars = body.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return asciiWords + cjkChars;
}
