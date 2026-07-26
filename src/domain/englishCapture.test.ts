import { describe, expect, it } from "vitest";
import {
  ankiWordQuery,
  classifyCapture,
  looksLikeSecret,
  normalizeHeadword,
  MAX_CAPTURE_CHARS,
} from "./englishCapture.js";

describe("normalizeHeadword", () => {
  it("lowercases a plain word", () => {
    expect(normalizeHeadword("Resilient")).toBe("resilient");
  });

  it("strips surrounding punctuation", () => {
    expect(normalizeHeadword("  (idempotent),")).toBe("idempotent");
    expect(normalizeHeadword("“throttle”")).toBe("throttle");
  });

  it("splits camelCase so code identifiers resolve to their first word", () => {
    expect(normalizeHeadword("resolveIngestDir")).toBe("resolve");
    expect(normalizeHeadword("getUserById")).toBe("get");
  });

  it("returns the first word of a longer fragment", () => {
    expect(normalizeHeadword("eventual consistency")).toBe("eventual");
  });

  it("returns empty when there is no Latin word", () => {
    expect(normalizeHeadword("缓存穿透")).toBe("");
    expect(normalizeHeadword("123 456")).toBe("");
  });
});

describe("looksLikeSecret", () => {
  it("catches well-known token shapes", () => {
    expect(looksLikeSecret("sk-a8Kd93jXm2QpLzR4tYuI")).toBe(true);
    expect(looksLikeSecret("ghp_16C7e42F292c6912E7710c838347Ae178B4a")).toBe(true);
    expect(looksLikeSecret("xoxb-123456789012-abcdefghijkl")).toBe(true);
    expect(looksLikeSecret("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-def_123")).toBe(true);
  });

  it("catches long opaque unbroken blobs", () => {
    expect(looksLikeSecret("d41d8cd98f00b204e9800998ecf8427e")).toBe(true);
    expect(looksLikeSecret("Tr0ub4dor&3xKcd!Passw0rd#Long")).toBe(true);
  });

  it("leaves real reading material alone", () => {
    expect(looksLikeSecret("resilient")).toBe(false);
    expect(looksLikeSecret("eventual consistency")).toBe(false);
    // Has spaces — reading material, even when it contains digits and symbols.
    expect(looksLikeSecret("HTTP 429 means you are rate-limited (too many requests)")).toBe(false);
    // Short identifiers are not treated as secrets.
    expect(looksLikeSecret("utf8mb4")).toBe(false);
  });
});

describe("classifyCapture", () => {
  it("classifies a single word", () => {
    expect(classifyCapture("Idempotent")).toEqual({
      kind: "word",
      text: "Idempotent",
      lookup: "idempotent",
    });
  });

  it("keeps a short collocation whole as a phrase", () => {
    expect(classifyCapture("eventual consistency")).toEqual({
      kind: "phrase",
      text: "eventual consistency",
      lookup: "eventual consistency",
    });
  });

  it("classifies a longer run as a sentence, with no lookup", () => {
    const raw = "The value that the function returns when the promise it awaits rejects.";
    expect(classifyCapture(raw)).toEqual({ kind: "sentence", text: raw, lookup: "" });
  });

  it("ignores an unchanged clipboard (it is polled, not evented)", () => {
    expect(classifyCapture("resilient", "resilient")).toEqual({
      kind: "ignore",
      reason: "unchanged",
    });
    // Whitespace-only differences still count as unchanged.
    expect(classifyCapture("  resilient  ", "resilient")).toEqual({
      kind: "ignore",
      reason: "unchanged",
    });
  });

  it("ignores empty, oversized, non-Latin and credential-shaped text", () => {
    expect(classifyCapture("   ")).toEqual({ kind: "ignore", reason: "empty" });
    expect(classifyCapture("x".repeat(MAX_CAPTURE_CHARS + 1))).toEqual({
      kind: "ignore",
      reason: "too_long",
    });
    expect(classifyCapture("缓存穿透与雪崩")).toEqual({ kind: "ignore", reason: "no_latin" });
    expect(classifyCapture("sk-a8Kd93jXm2QpLzR4tYuI")).toEqual({
      kind: "ignore",
      reason: "looks_like_secret",
    });
  });

  it("checks the secret rule before deciding a kind", () => {
    // A credential is a single "word" by word count — order matters here.
    const result = classifyCapture("ghp_16C7e42F292c6912E7710c838347Ae178B4a");
    expect(result.kind).toBe("ignore");
  });
});

describe("ankiWordQuery", () => {
  it("matches the word field of each note type in the collection", () => {
    expect(ankiWordQuery("agree")).toBe('"Word:agree" OR "Front:agree" OR "English:agree"');
  });

  it("escapes quotes so a stray character cannot break the query", () => {
    expect(ankiWordQuery('a"b')).toContain('Word:a\\"b');
  });
});
