/**
 * Thin AnkiConnect client. AnkiConnect is an add-on that exposes a JSON-RPC
 * endpoint on localhost while the Anki desktop app is running; it is the only
 * safe way to write to a live collection (touching `collection.anki2` directly
 * while Anki is open corrupts it).
 *
 * Conventions copied from `desktop/connectionDiagnostics.ts`: `fetch` is a
 * defaulted parameter so tests inject a fake, every call is bounded by
 * `AbortSignal.timeout`, and failures come back as a status union rather than a
 * thrown error — Anki being closed is the normal case, not an exception.
 */

type FetchLike = typeof fetch;

export type AnkiFailure =
  /** Nothing listening: Anki is closed, or the add-on is disabled. */
  | { ok: false; reason: "unreachable"; detail: string }
  /** Reached AnkiConnect, but the action itself failed. */
  | { ok: false; reason: "error"; detail: string };

export type AnkiResult<T> = { ok: true; result: T } | AnkiFailure;

export type AnkiConfig = {
  url: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
};

export function ankiConfig(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): AnkiConfig {
  return {
    url: env.APOTHECARY_ANKI_CONNECT_URL ?? "http://127.0.0.1:8765",
    timeoutMs: Number(env.APOTHECARY_ANKI_TIMEOUT_MS ?? 5_000),
    fetchImpl,
  };
}

/** One AnkiConnect action. Never throws. */
export async function invokeAnki<T>(
  config: AnkiConfig,
  action: string,
  params: Record<string, unknown> = {},
): Promise<AnkiResult<T>> {
  let response: Response;
  try {
    response = await config.fetchImpl(config.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { ok: false, reason: "unreachable", detail: message };
  }

  if (!response.ok) {
    return { ok: false, reason: "error", detail: `HTTP ${response.status}` };
  }

  let body: { result?: unknown; error?: string | null };
  try {
    body = (await response.json()) as { result?: unknown; error?: string | null };
  } catch {
    return { ok: false, reason: "error", detail: "malformed AnkiConnect response" };
  }

  if (body.error) return { ok: false, reason: "error", detail: body.error };
  return { ok: true, result: body.result as T };
}

/** Whether Anki is up; the version number is not otherwise interesting. */
export async function ankiReachable(config: AnkiConfig): Promise<AnkiResult<number>> {
  return invokeAnki<number>(config, "version");
}

export async function findNotes(config: AnkiConfig, query: string): Promise<AnkiResult<number[]>> {
  return invokeAnki<number[]>(config, "findNotes", { query });
}

export async function findCards(config: AnkiConfig, query: string): Promise<AnkiResult<number[]>> {
  return invokeAnki<number[]>(config, "findCards", { query });
}

/** Bring suspended cards back into the review queue. */
export async function unsuspendCards(
  config: AnkiConfig,
  cards: number[],
): Promise<AnkiResult<boolean>> {
  return invokeAnki<boolean>(config, "unsuspend", { cards });
}

/** Tags are space-separated in AnkiConnect's API, not an array. */
export async function addTags(
  config: AnkiConfig,
  notes: number[],
  tags: string[],
): Promise<AnkiResult<null>> {
  return invokeAnki<null>(config, "addTags", { notes, tags: tags.join(" ") });
}

export type NewNote = {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags: string[];
};

/**
 * Create a note. `duplicateScope: "collection"` is the point of this whole
 * exercise: the PopClip extension this replaces scoped duplicate detection to
 * one deck, so a word already sitting in the 4000 EEW reservoir was re-created
 * as a fresh card instead of being found. Callers search the collection first
 * anyway; this is the backstop.
 */
export async function addNote(config: AnkiConfig, note: NewNote): Promise<AnkiResult<number>> {
  return invokeAnki<number>(config, "addNote", {
    note: {
      ...note,
      options: { allowDuplicate: false, duplicateScope: "collection" },
    },
  });
}
