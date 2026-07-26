import { describe, expect, it, vi } from "vitest";
import { ingestCapture, CAPTURE_DECK, ENCOUNTERED_TAG } from "./ingestCapture.js";
import type { AnkiConfig } from "./ankiConnect.js";

type AnkiCall = { action: string; params: Record<string, unknown> };

/**
 * Fake AnkiConnect. `results` maps an action to what it returns; anything not
 * listed returns null. Records every call so the test can assert what was NOT
 * done (the whole point of the reservoir behaviour is that no card is created).
 */
function fakeAnki(results: Record<string, unknown>) {
  const calls: AnkiCall[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as AnkiCall;
    calls.push({ action: body.action, params: body.params });
    return new Response(JSON.stringify({ result: results[body.action] ?? null, error: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const config: AnkiConfig = {
    url: "http://127.0.0.1:8765",
    timeoutMs: 1_000,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  };
  return { config, calls, actions: () => calls.map((c) => c.action) };
}

const entry = { phonetic: "/ˌaɪdemˈpoʊtənt/", senses: [{ partOfSpeech: "adj", definition: "d" }] };

describe("ingestCapture", () => {
  it("activates the card that already exists instead of creating a duplicate", async () => {
    // The reservoir hit: `agree` is in 4000 EEW Book 1, suspended.
    const anki = fakeAnki({ findNotes: [1001], findCards: [2001, 2002] });

    const outcome = await ingestCapture(
      { kind: "word", text: "agree", lookup: "agree" },
      { config: anki.config, lookup: async () => entry },
    );

    expect(outcome).toEqual({ kind: "activated", notes: 1, unsuspended: 2 });
    expect(anki.actions()).toEqual(["findNotes", "findCards", "unsuspend", "addTags"]);
    // No new card, and no dictionary round-trip for a word already owned.
    expect(anki.actions()).not.toContain("addNote");

    const tagCall = anki.calls.find((c) => c.action === "addTags");
    expect(tagCall?.params).toMatchObject({ notes: [1001], tags: ENCOUNTERED_TAG });
    const unsuspendCall = anki.calls.find((c) => c.action === "unsuspend");
    expect(unsuspendCall?.params).toMatchObject({ cards: [2001, 2002] });
  });

  it("searches the whole collection, not just the capture deck", async () => {
    const anki = fakeAnki({ findNotes: [] , addNote: 5001 });

    await ingestCapture(
      { kind: "word", text: "idempotent", lookup: "idempotent" },
      { config: anki.config, lookup: async () => entry },
    );

    const find = anki.calls.find((c) => c.action === "findNotes");
    // Field-scoped across every note type in the collection.
    expect(find?.params.query).toBe(
      '"Word:idempotent" OR "Front:idempotent" OR "English:idempotent"',
    );
    const add = anki.calls.find((c) => c.action === "addNote");
    expect((add?.params.note as { options: unknown }).options).toMatchObject({
      allowDuplicate: false,
      duplicateScope: "collection",
    });
  });

  it("creates a card in the existing deck when the word is genuinely new", async () => {
    const anki = fakeAnki({ findNotes: [], addNote: 5001 });

    const outcome = await ingestCapture(
      { kind: "word", text: "idempotent", lookup: "idempotent" },
      { config: anki.config, lookup: async () => entry },
    );

    expect(outcome).toEqual({ kind: "created", noteId: 5001 });
    const note = anki.calls.find((c) => c.action === "addNote")?.params.note as {
      deckName: string;
      fields: { Front: string; Back: string };
    };
    expect(note.deckName).toBe(CAPTURE_DECK);
    expect(note.fields.Front).toBe("idempotent");
    expect(note.fields.Back).toContain("/ˌaɪdemˈpoʊtənt/");
  });

  it("still creates a card when the dictionary has no entry", async () => {
    const anki = fakeAnki({ findNotes: [], addNote: 5002 });

    const outcome = await ingestCapture(
      { kind: "word", text: "webhook", lookup: "webhook" },
      { config: anki.config, lookup: async () => null },
    );

    expect(outcome).toEqual({ kind: "created", noteId: 5002 });
    const note = anki.calls.find((c) => c.action === "addNote")?.params.note as {
      fields: { Back: string };
    };
    expect(note.fields.Back).toContain("待补");
  });

  it("keeps the captured sentence as context on a phrase card", async () => {
    const anki = fakeAnki({ findNotes: [], addNote: 5003 });

    await ingestCapture(
      { kind: "phrase", text: "eventual consistency", lookup: "eventual consistency", sourceLabel: "AWS docs" },
      { config: anki.config, lookup: async () => null },
    );

    const note = anki.calls.find((c) => c.action === "addNote")?.params.note as {
      fields: { Back: string };
    };
    expect(note.fields.Back).toContain("eventual consistency");
    expect(note.fields.Back).toContain("AWS docs");
  });

  it("defers instead of failing when Anki is closed", async () => {
    const config: AnkiConfig = {
      url: "http://127.0.0.1:8765",
      timeoutMs: 1_000,
      fetchImpl: (async () => {
        throw new Error("connect ECONNREFUSED");
      }) as unknown as typeof fetch,
    };

    const outcome = await ingestCapture(
      { kind: "word", text: "resilient", lookup: "resilient" },
      { config, lookup: async () => entry },
    );

    expect(outcome).toMatchObject({ kind: "deferred" });
  });

  it("leaves sentences for the syntax breakdown rather than making a card", async () => {
    const anki = fakeAnki({});

    const outcome = await ingestCapture(
      { kind: "sentence", text: "The value that the function returns.", lookup: "" },
      { config: anki.config, lookup: async () => null },
    );

    expect(outcome).toEqual({ kind: "skipped", detail: "sentence_awaiting_breakdown" });
    expect(anki.calls).toEqual([]);
  });
});
