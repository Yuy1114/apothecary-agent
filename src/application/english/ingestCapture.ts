import { ankiWordQuery, type CaptureKind } from "../../domain/englishCapture.js";
import {
  addNote,
  addTags,
  findCards,
  findNotes,
  unsuspendCards,
  type AnkiConfig,
} from "./ankiConnect.js";
import { lookupWord, renderCardBack, type WordEntry } from "./dictionary.js";
import {
  listPendingCaptures,
  resolveCapture,
  type CaptureRecord,
} from "../../vault/englishCaptureLog.js";

/**
 * Settle a capture against the Anki collection.
 *
 * The collection already holds 3900+ cards (the 4000 Essential English Words
 * series) of which the overwhelming majority have never been studied, so the
 * default move for a captured word is NOT to make a card — it is to find the
 * one that already exists and bring it back into the queue. Real reading is
 * what decides which of the reservoir gets activated; only genuinely new words
 * become new cards.
 */

/** Yuy's existing deck/model for self-captured words — nothing new in Anki. */
export const CAPTURE_DECK = "CS Vocabulary";
export const CAPTURE_MODEL = "Basic";
/** Marks a reservoir card as one he actually ran into while reading. */
export const ENCOUNTERED_TAG = "遇到过";
export const CAPTURE_TAG = "apothecary";

export type IngestOutcome =
  /** The word was already in the collection; its cards were unsuspended. */
  | { kind: "activated"; notes: number; unsuspended: number }
  | { kind: "created"; noteId: number }
  /** Anki is closed — the capture stays queued for the next drain. */
  | { kind: "deferred"; detail: string }
  | { kind: "skipped"; detail: string };

export type IngestDeps = {
  config: AnkiConfig;
  /** Injected so tests do not hit the dictionary API. */
  lookup?: (word: string) => Promise<WordEntry | null>;
};

/** Sentences are captured for the (not yet built) syntax breakdown, not for Anki. */
function isVocabulary(kind: CaptureKind): boolean {
  return kind === "word" || kind === "phrase";
}

export async function ingestCapture(
  capture: { kind: CaptureKind; text: string; lookup: string; sourceLabel?: string },
  deps: IngestDeps,
): Promise<IngestOutcome> {
  if (!isVocabulary(capture.kind)) {
    return { kind: "skipped", detail: "sentence_awaiting_breakdown" };
  }
  if (!capture.lookup) return { kind: "skipped", detail: "no_lookup_term" };

  const query = ankiWordQuery(capture.lookup);
  const existing = await findNotes(deps.config, query);
  if (!existing.ok) {
    if (existing.reason === "unreachable") return { kind: "deferred", detail: existing.detail };
    return { kind: "skipped", detail: `find_failed: ${existing.detail}` };
  }

  if (existing.result.length > 0) {
    // Reservoir hit. Unsuspend whatever is suspended and mark the notes, so the
    // card he has already paid for surfaces instead of a duplicate.
    let unsuspended = 0;
    const suspended = await findCards(deps.config, `(${query}) is:suspended`);
    if (suspended.ok && suspended.result.length > 0) {
      const released = await unsuspendCards(deps.config, suspended.result);
      if (released.ok) unsuspended = suspended.result.length;
    }
    await addTags(deps.config, existing.result, [ENCOUNTERED_TAG]);
    return { kind: "activated", notes: existing.result.length, unsuspended };
  }

  const entry = await (deps.lookup ?? ((word: string) => lookupWord(word)))(capture.lookup);
  const created = await addNote(deps.config, {
    deckName: CAPTURE_DECK,
    modelName: CAPTURE_MODEL,
    fields: {
      Front: capture.lookup,
      Back: renderCardBack({
        entry,
        // For a single word the copied text IS the word; only keep a real sentence.
        context: capture.kind === "phrase" ? capture.text : undefined,
        sourceLabel: capture.sourceLabel,
      }),
    },
    tags: [CAPTURE_TAG],
  });

  if (!created.ok) {
    if (created.reason === "unreachable") return { kind: "deferred", detail: created.detail };
    return { kind: "skipped", detail: `add_failed: ${created.detail}` };
  }
  return { kind: "created", noteId: created.result };
}

export type DrainReport = {
  activated: number;
  created: number;
  skipped: number;
  deferred: number;
};

/**
 * Settle the vocabulary captures waiting in the queue. Returns early on the
 * first `deferred` result: that means Anki is closed, so every remaining capture
 * would fail identically and must stay queued rather than be marked failed.
 *
 * Sentence captures are left out of the query entirely — they are pending work
 * for the syntax breakdown, not for Anki.
 */
export async function drainCaptures(deps: IngestDeps, limit = 50): Promise<DrainReport> {
  const report: DrainReport = { activated: 0, created: 0, skipped: 0, deferred: 0 };
  const pending: CaptureRecord[] = await listPendingCaptures({
    limit,
    kinds: ["word", "phrase"],
  });

  for (const capture of pending) {
    const outcome = await ingestCapture(capture, deps);
    switch (outcome.kind) {
      case "activated":
        report.activated += 1;
        await resolveCapture(capture.id, "pushed", `activated:${outcome.unsuspended}`);
        break;
      case "created":
        report.created += 1;
        await resolveCapture(capture.id, "pushed", `created:${outcome.noteId}`);
        break;
      case "skipped":
        report.skipped += 1;
        await resolveCapture(capture.id, "skipped", outcome.detail);
        break;
      case "deferred":
        report.deferred = pending.length - (report.activated + report.created + report.skipped);
        return report;
    }
  }
  return report;
}
