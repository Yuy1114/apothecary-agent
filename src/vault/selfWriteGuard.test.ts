import { afterEach, describe, expect, it } from "vitest";
import { clearSelfWrite, clearSelfWriteMarks, isSelfWrite, markSelfWrite } from "./selfWriteGuard.js";

afterEach(() => clearSelfWriteMarks());

describe("selfWriteGuard", () => {
  it("recognises a marked path and ignores unmarked ones", () => {
    markSelfWrite(["references/idea.txt", "references/README.md"]);
    expect(isSelfWrite("references/idea.txt")).toBe(true);
    expect(isSelfWrite("references/README.md")).toBe(true);
    expect(isSelfWrite("inbox/other.md")).toBe(false);
  });

  it("stays marked across the repeated fs events a single write emits", () => {
    markSelfWrite(["notes/a.md"]);
    expect(isSelfWrite("notes/a.md")).toBe(true);
    expect(isSelfWrite("notes/a.md")).toBe(true);
  });

  it("normalises backslash and ./ prefixed paths to the watcher form", () => {
    markSelfWrite(["./notes\\b.md"]);
    expect(isSelfWrite("notes/b.md")).toBe(true);
  });

  it("expires marks via the backstop TTL so a later external edit is caught", () => {
    markSelfWrite(["notes/c.md"], -1);
    expect(isSelfWrite("notes/c.md")).toBe(false);
  });

  it("clearSelfWrite releases a mark immediately (no TTL wait)", () => {
    markSelfWrite(["notes/d.md", "notes/e.md"]);
    clearSelfWrite(["notes/d.md"]);
    // Cleared path is now open to external-edit detection; the other stays marked.
    expect(isSelfWrite("notes/d.md")).toBe(false);
    expect(isSelfWrite("notes/e.md")).toBe(true);
  });

  it("clearSelfWrite normalises paths the same way as marking", () => {
    markSelfWrite(["notes/f.md"]);
    clearSelfWrite(["./notes\\f.md"]);
    expect(isSelfWrite("notes/f.md")).toBe(false);
  });
});
