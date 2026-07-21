import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mastra } from "@mastra/core/mastra";
import {
  classifyWatchEvent,
  getAutoIntakeStatus,
  runAutoIntake,
  runStartupCatchUp,
  shouldCatchUpAutoIntake,
  shouldScheduleAutoIntake,
} from "./sync-watcher.js";
import type { ManualSyncReport } from "../../application/sync/manualSync.js";

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

describe("shouldCatchUpAutoIntake", () => {
  it("plans when opted in and _inbox has items", () => {
    expect(shouldCatchUpAutoIntake(1, true)).toBe(true);
    expect(shouldCatchUpAutoIntake(5, true)).toBe(true);
  });

  it("never plans when the feature is off", () => {
    expect(shouldCatchUpAutoIntake(3, false)).toBe(false);
  });

  it("never plans when _inbox is empty", () => {
    expect(shouldCatchUpAutoIntake(0, true)).toBe(false);
  });
});

describe("runStartupCatchUp", () => {
  const mastra = {} as Mastra;
  const cleanReport: ManualSyncReport = {
    created: 0,
    modified: 0,
    deleted: 0,
    unchanged: 3,
    semanticRefreshed: false,
  };

  afterEach(() => {
    delete process.env.APOTHECARY_AUTO_INTAKE;
    vi.restoreAllMocks();
  });

  function deps(over: Partial<Parameters<typeof runStartupCatchUp>[1]> = {}) {
    return {
      sync: vi.fn(async () => cleanReport),
      survey: vi.fn(async () => ({ entries: [] as unknown[] })),
      schedule: vi.fn(),
      ...over,
    };
  }

  it("always runs the offline-change sync (index/ledger/semantic catch-up)", async () => {
    const d = deps();
    await runStartupCatchUp(mastra, d);
    expect(d.sync).toHaveBeenCalledOnce();
  });

  it("schedules auto-intake when opted in and _inbox is non-empty", async () => {
    process.env.APOTHECARY_AUTO_INTAKE = "1";
    const d = deps({ survey: vi.fn(async () => ({ entries: [{ path: "_inbox/a.md" }] })) });
    await runStartupCatchUp(mastra, d);
    expect(d.schedule).toHaveBeenCalledWith(mastra);
  });

  it("does not survey or schedule when auto-intake is off", async () => {
    const d = deps({ survey: vi.fn(async () => ({ entries: [{ path: "_inbox/a.md" }] })) });
    await runStartupCatchUp(mastra, d);
    expect(d.survey).not.toHaveBeenCalled();
    expect(d.schedule).not.toHaveBeenCalled();
  });

  it("does not schedule when _inbox is empty even if opted in", async () => {
    process.env.APOTHECARY_AUTO_INTAKE = "1";
    const d = deps();
    await runStartupCatchUp(mastra, d);
    expect(d.survey).toHaveBeenCalledOnce();
    expect(d.schedule).not.toHaveBeenCalled();
  });

  it("still surveys _inbox when the offline sync fails (halves are isolated)", async () => {
    process.env.APOTHECARY_AUTO_INTAKE = "1";
    const d = deps({
      sync: vi.fn(async () => {
        throw new Error("scan blew up");
      }),
      survey: vi.fn(async () => ({ entries: [{ path: "_inbox/a.md" }] })),
    });
    await expect(runStartupCatchUp(mastra, d)).resolves.toBeUndefined();
    expect(d.schedule).toHaveBeenCalledOnce();
  });
});

describe("runAutoIntake state machine", () => {
  const mastra = {} as Mastra;

  it("planning → proposed when a plan produces a proposal", async () => {
    await runAutoIntake(mastra, {
      plan: vi.fn(async () => {}),
      propose: vi.fn(async () => ({ proposalId: "prop-1", actionable: 3, superseded: 0 })),
    });
    const status = getAutoIntakeStatus();
    expect(status.phase).toBe("proposed");
    expect(status.lastProposalId).toBe("prop-1");
    expect(status.actionable).toBe(3);
  });

  it("planning → idle when the plan has nothing actionable", async () => {
    await runAutoIntake(mastra, {
      plan: vi.fn(async () => {}),
      propose: vi.fn(async () => ({ actionable: 0, superseded: 0 })),
    });
    expect(getAutoIntakeStatus().phase).toBe("idle");
  });

  it("planning → failed, capturing the error message, when planning throws", async () => {
    await runAutoIntake(mastra, {
      plan: vi.fn(async () => {
        throw new Error("organizer down");
      }),
      propose: vi.fn(async () => ({ actionable: 0, superseded: 0 })),
    });
    const status = getAutoIntakeStatus();
    expect(status.phase).toBe("failed");
    expect(status.lastError).toContain("organizer down");
  });
});
