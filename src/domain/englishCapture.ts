/**
 * Reading-mode capture rules: what counts as a word worth looking up, what is a
 * sentence to be broken down later, and what must never leave the machine.
 *
 * Pure. The clipboard is read in `desktop/`, the lookup and the Anki round-trip
 * happen in `application/english/`; everything judgemental lives here so it can
 * be tested without a clipboard, a network or a database.
 */

/** Longest capture we accept. Beyond this it is a document, not a reading unit. */
export const MAX_CAPTURE_CHARS = 600;

/** A single word goes straight to lookup; longer runs are handled differently. */
export type CaptureKind = "word" | "phrase" | "sentence";

export type IgnoreReason =
  | "empty"
  | "too_long"
  | "no_latin"
  | "looks_like_secret"
  | "unchanged";

export type Capture =
  | {
      kind: CaptureKind;
      /** The text as copied, kept verbatim for the card's context. */
      text: string;
      /** Normalized head word for dictionary/Anki lookup; "" for sentences. */
      lookup: string;
    }
  | { kind: "ignore"; reason: IgnoreReason };

/**
 * Credential-shaped text that must be dropped before anything is stored, sent to
 * a dictionary API, or written to a card.
 *
 * Deliberately conservative: it drops some legitimate captures (a long unbroken
 * identifier) rather than risk keeping one secret. It is NOT a guarantee — the
 * real protection is that reading mode is off by default and auto-expires, and
 * that captured text never reaches the log. Treat this as the second line.
 */
export function looksLikeSecret(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Well-known token shapes, regardless of length.
  if (/^(sk|pk|rk)-[A-Za-z0-9_-]{8,}/.test(trimmed)) return true;
  if (/^(gh[pousr]_|xox[abprs]-|npm_|AIza|ya29\.)/.test(trimmed)) return true;
  // JWTs: three base64url segments.
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) return true;
  if (/^-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}/.test(trimmed)) return true;

  // Beyond that, only unbroken runs are suspicious — real reading material has spaces.
  if (/\s/.test(trimmed)) return false;
  if (trimmed.length < 20) return false;

  // Long opaque blobs: hex/base64 digests, random passwords.
  if (/^[0-9a-f]{32,}$/i.test(trimmed)) return true;
  if (/^[A-Za-z0-9+/]{32,}={0,2}$/.test(trimmed)) return true;

  const hasLetter = /[A-Za-z]/.test(trimmed);
  const hasDigit = /\d/.test(trimmed);
  const hasSymbol = /[^A-Za-z0-9]/.test(trimmed);
  return hasLetter && hasDigit && hasSymbol;
}

/**
 * Reduce a copied fragment to a single lower-case head word for lookup.
 *
 * Ported from the PopClip extension this replaces, including its most useful
 * trick: splitting camelCase so selecting `resolveIngestDir` in code looks up
 * `resolve` rather than failing. Returns "" when there is no Latin word at all.
 */
export function normalizeHeadword(text: string): string {
  const withoutLeadingJunk = text.trim().replace(/^[^A-Za-z0-9]+/, "");
  const camelSplit = withoutLeadingJunk.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const words = camelSplit.match(/[A-Za-z]+/g);
  return words?.[0]?.toLowerCase() ?? "";
}

/** Words in a fragment, used to tell a phrase from a sentence. */
function latinWordCount(text: string): number {
  return text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)?.length ?? 0;
}

/**
 * Decide what a clipboard fragment is. `previous` is the last capture accepted
 * in this session: the clipboard is polled, so the same text is seen on every
 * tick until it changes.
 */
export function classifyCapture(raw: string, previous?: string): Capture {
  const text = raw.trim();
  if (!text) return { kind: "ignore", reason: "empty" };
  if (previous !== undefined && text === previous.trim()) {
    return { kind: "ignore", reason: "unchanged" };
  }
  if (text.length > MAX_CAPTURE_CHARS) return { kind: "ignore", reason: "too_long" };
  if (looksLikeSecret(text)) return { kind: "ignore", reason: "looks_like_secret" };

  const words = latinWordCount(text);
  // Chinese notes, numbers, punctuation — nothing to learn as English.
  if (words === 0) return { kind: "ignore", reason: "no_latin" };

  if (words === 1) return { kind: "word", text, lookup: normalizeHeadword(text) };
  // A short run is a collocation worth keeping whole ("eventual consistency");
  // anything longer is a sentence for structural breakdown, not vocabulary.
  if (words <= 4) return { kind: "phrase", text, lookup: text.toLowerCase() };
  return { kind: "sentence", text, lookup: "" };
}

/**
 * Anki search matching a head word against the field each of Yuy's note types
 * uses for the word itself: `Word` (4000 Essential English Words), `Front`
 * (Basic) and `English` (4000 EEW Extra). Field searches are exact, so this
 * finds the reservoir card without matching example sentences that merely
 * mention the word.
 */
export function ankiWordQuery(lookup: string): string {
  const escaped = lookup.replaceAll('"', '\\"');
  return ["Word", "Front", "English"].map((field) => `"${field}:${escaped}"`).join(" OR ");
}
