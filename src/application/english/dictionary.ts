/**
 * Dictionary enrichment for a newly captured word, via the free
 * dictionaryapi.dev service. Ported from the PopClip extension this replaces.
 *
 * English definitions only, on purpose: the whole point of the reading track is
 * to stop translating word-by-word, and a Chinese gloss on the card puts that
 * habit back into review. Words already in the 4000 EEW reservoir keep their
 * built-in Chinese — those cards are never rewritten.
 *
 * Same conventions as the Anki client: injected `fetch`, bounded by
 * `AbortSignal.timeout`, failure is a value. A lookup miss is normal (technical
 * jargon often is not in a general dictionary) and must not block the card.
 */

type FetchLike = typeof fetch;

export type WordSense = {
  partOfSpeech: string;
  definition: string;
  example?: string;
};

export type WordEntry = {
  phonetic: string;
  senses: WordSense[];
};

const MAX_SENSES = 3;

type ApiEntry = {
  phonetic?: string;
  phonetics?: { text?: string }[];
  meanings?: {
    partOfSpeech?: string;
    definitions?: { definition?: string; example?: string }[];
  }[];
};

/** Look a word up. Returns null when the word is unknown or the API is unusable. */
export async function lookupWord(
  word: string,
  options: { fetchImpl?: FetchLike; timeoutMs?: number; baseUrl?: string } = {},
): Promise<WordEntry | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 6_000;
  const baseUrl = options.baseUrl ?? "https://api.dictionaryapi.dev/api/v2/entries/en";
  const url = `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(word)}`;

  let payload: unknown;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    payload = await response.json();
  } catch {
    return null;
  }

  if (!Array.isArray(payload) || payload.length === 0) return null;
  const entry = payload[0] as ApiEntry;

  const phonetic =
    entry.phonetic?.trim() || entry.phonetics?.find((p) => p.text?.trim())?.text?.trim() || "";

  const senses: WordSense[] = [];
  for (const meaning of entry.meanings ?? []) {
    for (const definition of meaning.definitions ?? []) {
      if (!definition.definition) continue;
      senses.push({
        partOfSpeech: meaning.partOfSpeech ?? "",
        definition: definition.definition,
        example: definition.example,
      });
      if (senses.length >= MAX_SENSES) break;
    }
    if (senses.length >= MAX_SENSES) break;
  }

  if (!phonetic && senses.length === 0) return null;
  return { phonetic, senses };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Render the back of a new card: the dictionary entry, then the sentence the
 * word was actually met in. The captured context matters more than the
 * definition for recall — it is the cue that will bring the word back.
 */
export function renderCardBack(input: {
  entry: WordEntry | null;
  context?: string;
  sourceLabel?: string;
}): string {
  const lines: string[] = [];

  if (input.entry?.phonetic) lines.push(escapeHtml(input.entry.phonetic));

  for (const [index, sense] of (input.entry?.senses ?? []).entries()) {
    const pos = sense.partOfSpeech ? ` (${escapeHtml(sense.partOfSpeech)})` : "";
    lines.push(`${index + 1}.${pos} ${escapeHtml(sense.definition)}`);
    if (sense.example) lines.push(`&nbsp;&nbsp;&nbsp;e.g. ${escapeHtml(sense.example)}`);
  }

  if (!input.entry) lines.push("<i>词典无此词条，待补</i>");

  if (input.context) {
    lines.push("", "<b>遇到时的原句</b>", escapeHtml(input.context));
  }
  if (input.sourceLabel) {
    lines.push(`<small>${escapeHtml(input.sourceLabel)}</small>`);
  }

  return lines.join("<br>");
}
