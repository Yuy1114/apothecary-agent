// Pure helpers for the quick-ask (划词快问) popover: given the raw text of a note
// and the text the user selected in the rendered view, extract the enclosing
// markdown section as the bounded context to send. DOM-free so vitest covers it.

const HEADING = /^#{1,6}\s/;

/**
 * Collapses whitespace runs into single spaces while keeping a map from each
 * normalized character back to its offset in the original text, so a match in
 * normalized space can be translated to a raw slice. Rendered markdown collapses
 * newlines/indentation, which is why an exact `indexOf` can miss.
 */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (norm.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      norm += " ";
      map.push(i - 1);
      pendingSpace = false;
    }
    norm += ch;
    map.push(i);
  }
  return { norm, map };
}

/** Locates `selection` in `raw`, exact first, whitespace-normalized second. */
function locate(raw: string, selection: string): { start: number; end: number } | null {
  const exact = raw.indexOf(selection);
  if (exact >= 0) return { start: exact, end: exact + selection.length };
  const target = selection.trim().replace(/\s+/g, " ");
  if (!target) return null;
  const { norm, map } = normalizeWithMap(raw);
  const idx = norm.indexOf(target);
  if (idx < 0) return null;
  return { start: map[idx], end: map[idx + target.length - 1] + 1 };
}

/**
 * Returns the enclosing section of `raw` around `selection`: from the nearest
 * markdown heading line above it to the next heading line below it. Falls back
 * to `raw.slice(0, cap)` when the selection cannot be located (rendered text
 * that diverged too far from the source). Results never exceed `cap` and, when
 * located, always contain the selection.
 */
export function sliceEnclosingSection(raw: string, selection: string, cap = 8000): string {
  const hit = locate(raw, selection);
  if (!hit) return raw.slice(0, cap);

  let sectionStart = 0;
  for (let lineStart = raw.lastIndexOf("\n", hit.start - 1) + 1; ; ) {
    if (HEADING.test(raw.slice(lineStart, lineStart + 8))) {
      sectionStart = lineStart;
      break;
    }
    if (lineStart === 0) break;
    lineStart = raw.lastIndexOf("\n", lineStart - 2) + 1;
  }

  let sectionEnd = raw.length;
  for (let lineStart = raw.indexOf("\n", hit.end) + 1; lineStart > 0 && lineStart < raw.length; ) {
    if (HEADING.test(raw.slice(lineStart, lineStart + 8))) {
      sectionEnd = lineStart;
      break;
    }
    lineStart = raw.indexOf("\n", lineStart) + 1;
  }

  if (sectionEnd - sectionStart <= cap) return raw.slice(sectionStart, sectionEnd);
  // Oversized section: keep the heading when the selection still fits after it,
  // otherwise take the cap-sized window ending at the selection.
  if (hit.end - sectionStart <= cap) return raw.slice(sectionStart, sectionStart + cap);
  return raw.slice(hit.end - cap, hit.end);
}
