import { afterEach, describe, expect, it } from "vitest";
import { clearSelfWriteMarks, isSelfWrite, markSelfWrite } from "./selfWriteGuard.js";

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

  it("expires marks so a later external edit is caught", () => {
    markSelfWrite(["notes/c.md"], -1);
    expect(isSelfWrite("notes/c.md")).toBe(false);
  });
});
