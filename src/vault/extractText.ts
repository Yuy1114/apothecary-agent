import { promises as fs } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import { safeVaultPath } from "../safety/pathSafety.js";

/**
 * Read the text out of the document formats that actually land in `_inbox`, so
 * the organizer can place a PDF or a slide deck on what it says rather than on
 * what its filename happens to be.
 *
 * Only formats whose text can be recovered *faithfully* are here. Images, video
 * and audio are absent on purpose: they need a vision model or a transcriber,
 * which is a separate decision about a provider and its cost. 快速归位 already
 * gives those a destination by rule, so nothing is stranded meanwhile.
 *
 * OOXML (.docx/.pptx/.xlsx) is a zip of XML; the text runs are pulled out
 * directly rather than through a document-model library, because all we need is
 * the prose and a parser would be a large dependency for a small job.
 */

export type ExtractedVia = "plain" | "pdf" | "docx" | "pptx" | "xlsx" | "html";

export type ExtractedText = {
  filePath: string;
  via: ExtractedVia;
  content: string;
  lineCount: number;
  truncated: boolean;
  /** Pages/slides/sheets seen, when the format has them. */
  units?: number;
};

/** Beyond this, a document is being skimmed for placement, not read. */
const MAX_PDF_PAGES = 30;
const MAX_PPTX_SLIDES = 60;

const PLAIN_EXTS = new Set([".md", ".markdown", ".txt", ".text", ".csv", ".log", ".json", ".yaml", ".yml"]);

export function extractableExtensions(): string[] {
  return [...PLAIN_EXTS, ".pdf", ".docx", ".pptx", ".xlsx", ".html", ".htm"];
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return XML_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Clean up what a text layer gives back.
 *
 * PDF producers emit CJK text as Kangxi radicals (`⽅` U+2F45 rather than `方`)
 * and put a space between every glyph, which reads as gibberish to a model.
 * NFKC fixes the radicals; the space collapse is restricted to spaces and tabs
 * so paragraph breaks — real structure worth keeping — survive. (The CJK
 * Radicals Supplement block has no NFKC mapping and passes through; it is rare
 * enough not to be worth a hand-maintained table.)
 */
export function tidyExtracted(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/(?<=[一-鿿])[ \t]+(?=[一-鿿])/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Text runs out of one OOXML part, in document order, with a newline at every
 * paragraph end. One regex alternation keeps runs and breaks in sequence.
 */
export function ooxmlText(xml: string, textTag: string, paragraphTag: string): string {
  const pattern = new RegExp(`<${textTag}[^>]*>([\\s\\S]*?)</${textTag}>|</${paragraphTag}>`, "g");
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    parts.push(match[1] === undefined ? "\n" : decodeEntities(match[1]));
  }
  return parts.join("");
}

/** Strip a saved web page down to its prose. */
export function htmlText(html: string): string {
  const body = html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Block-level ends become breaks so the structure is not lost to one blob.
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(body);
}

async function readPdf(bytes: Uint8Array): Promise<{ text: string; units: number; truncated: boolean }> {
  const { extractText: pdfExtractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await pdfExtractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text)];
  const kept = pages.slice(0, MAX_PDF_PAGES);
  return {
    text: kept.join("\n\n"),
    units: totalPages,
    truncated: pages.length > kept.length,
  };
}

function readOoxml(
  bytes: Uint8Array,
  kind: "docx" | "pptx" | "xlsx",
): { text: string; units?: number; truncated: boolean } {
  const files = unzipSync(bytes);
  const decoder = new TextDecoder();
  const part = (name: string): string | null => (files[name] ? decoder.decode(files[name]) : null);

  if (kind === "docx") {
    const xml = part("word/document.xml");
    if (xml === null) throw new Error("docx_missing_document_part");
    return { text: ooxmlText(xml, "w:t", "w:p"), truncated: false };
  }

  if (kind === "xlsx") {
    // Cell values live in a shared string table; that is the prose worth having.
    const xml = part("xl/sharedStrings.xml");
    return { text: xml === null ? "" : ooxmlText(xml, "t", "si"), truncated: false };
  }

  const slideNames = Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const index = (name: string) => Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return index(a) - index(b);
    });
  const kept = slideNames.slice(0, MAX_PPTX_SLIDES);
  const slides = kept.map((name, position) => {
    const body = ooxmlText(decoder.decode(files[name]), "a:t", "a:p");
    return `— 第 ${position + 1} 页 —\n${body.trim()}`;
  });
  return {
    text: slides.join("\n\n"),
    units: slideNames.length,
    truncated: slideNames.length > kept.length,
  };
}

/**
 * Extract a bounded text excerpt from one vault file. Throws `unsupported_type`
 * for a format with no recoverable text, and `file_not_found` for a missing one
 * — both are conditions the caller should report, not swallow.
 */
export async function extractDocumentText(
  vaultPath: string,
  filePath: string,
  limit = 4000,
): Promise<ExtractedText> {
  const absolutePath = safeVaultPath(vaultPath, filePath);
  if (!absolutePath) throw new Error("unsafe_path");
  const extension = path.extname(filePath).toLowerCase();

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await fs.readFile(absolutePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("file_not_found");
    throw error;
  }

  let via: ExtractedVia;
  let raw: string;
  let units: number | undefined;
  let truncatedBySource = false;

  if (PLAIN_EXTS.has(extension)) {
    via = "plain";
    raw = new TextDecoder().decode(bytes);
  } else if (extension === ".pdf") {
    via = "pdf";
    const result = await readPdf(bytes);
    ({ text: raw, units } = result);
    truncatedBySource = result.truncated;
  } else if (extension === ".docx" || extension === ".pptx" || extension === ".xlsx") {
    via = extension.slice(1) as "docx" | "pptx" | "xlsx";
    const result = readOoxml(bytes, via);
    ({ text: raw, units } = result);
    truncatedBySource = result.truncated;
  } else if (extension === ".html" || extension === ".htm") {
    via = "html";
    raw = htmlText(new TextDecoder().decode(bytes));
  } else {
    throw new Error("unsupported_type");
  }

  // Markdown and plain text are already what the author wrote — normalising them
  // would rewrite the user's own bytes. Only recovered text gets tidied.
  const content = via === "plain" ? raw : tidyExtracted(raw);
  const clipped = content.slice(0, limit);

  return {
    filePath,
    via,
    content: clipped,
    lineCount: clipped === "" ? 0 : clipped.split("\n").length,
    truncated: truncatedBySource || content.length > limit,
    units,
  };
}
