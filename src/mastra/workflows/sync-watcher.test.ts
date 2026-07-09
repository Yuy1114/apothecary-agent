import { describe, expect, it } from "vitest";
import { classifyWatchEvent, shouldScheduleAutoIntake } from "./sync-watcher.js";

describe("classifyWatchEvent", () => {
  it("is unchanged when the current hash matches the baseline (a self-write echo)", () => {
    expect(classifyWatchEvent("abc", "abc")).toBe("unchanged");
  });

  it("is modified when the file exists but its hash differs from the baseline", () => {
    expect(classifyWatchEvent("new", "old")).toBe("modified");
  });

  it("is created when the file exists but the baseline has no entry", () => {
    expect(classifyWatchEvent("abc", null)).toBe("created");
  });

  it("is deleted when the file is gone but the baseline had it", () => {
    expect(classifyWatchEvent(null, "old")).toBe("deleted");
  });

  it("is unchanged when the file is gone and the baseline never had it", () => {
    expect(classifyWatchEvent(null, null)).toBe("unchanged");
  });
});

describe("shouldScheduleAutoIntake", () => {
  it("schedules for an _inbox change when enabled", () => {
    expect(shouldScheduleAutoIntake("_inbox/note.md", true)).toBe(true);
    expect(shouldScheduleAutoIntake("_inbox/sub/note.md", true)).toBe(true);
  });

  it("never schedules when the feature is off", () => {
    expect(shouldScheduleAutoIntake("_inbox/note.md", false)).toBe(false);
  });

  it("never schedules for changes outside _inbox", () => {
    expect(shouldScheduleAutoIntake("notes/note.md", true)).toBe(false);
    // A sibling prefix must not match — only the `_inbox/` folder counts.
    expect(shouldScheduleAutoIntake("_inbox-archive/note.md", true)).toBe(false);
  });
});
