import { describe, expect, it } from "vitest";
import { buildRecentActivity } from "./recentActivity.js";
import type { ChangeRecord } from "../../vault/changeLog.js";
import type { OperationRecord } from "../../vault/operationLedger.js";

const change = (overrides: Partial<ChangeRecord>): ChangeRecord => ({
  id: "change_1",
  path: "notes/a.md",
  changeType: "modified",
  source: "watcher",
  status: "pending",
  detectedAt: "2026-07-10T10:00:00.000Z",
  ...overrides,
});

const operation = (overrides: Partial<OperationRecord>): OperationRecord => ({
  id: "op_1",
  type: "move",
  targetFiles: ["_inbox/idea.md", "2-areas/writing/idea.md"],
  rationale: "归位到写作领域",
  source: "executeIntake",
  appliedAt: "2026-07-10T11:00:00.000Z",
  detail: "",
  ...overrides,
});

describe("buildRecentActivity", () => {
  it("merges both ledgers newest-first", () => {
    const items = buildRecentActivity(
      [
        change({ id: "c1", detectedAt: "2026-07-10T09:00:00.000Z" }),
        change({ id: "c2", detectedAt: "2026-07-12T09:00:00.000Z" }),
      ],
      [operation({ id: "o1", appliedAt: "2026-07-11T09:00:00.000Z" })],
    );
    expect(items.map((item) => item.id)).toEqual(["c2", "o1", "c1"]);
  });

  it("maps changes to user actor and operations to agent actor", () => {
    const items = buildRecentActivity(
      [change({ changeType: "created" })],
      [operation({})],
    );
    expect(items.find((item) => item.actor === "user")).toMatchObject({
      kind: "created",
      path: "notes/a.md",
    });
    expect(items.find((item) => item.actor === "agent")).toMatchObject({ kind: "move" });
  });

  it("uses the destination as primary path for relocating operations", () => {
    const [item] = buildRecentActivity([], [operation({})]);
    expect(item.path).toBe("2-areas/writing/idea.md");
    expect(item.fromPath).toBe("_inbox/idea.md");
    expect(item.detail).toBe("归位到写作领域");
  });

  it("uses the first target for non-relocating operations, without fromPath", () => {
    const [item] = buildRecentActivity(
      [],
      [operation({ type: "capture", targetFiles: ["3-resources/clips/quote.md"] })],
    );
    expect(item.path).toBe("3-resources/clips/quote.md");
    expect(item.fromPath).toBeUndefined();
  });

  it("treats a single-target move as non-relocated rather than pointing from=to", () => {
    const [item] = buildRecentActivity(
      [],
      [operation({ targetFiles: ["notes/only.md"] })],
    );
    expect(item.path).toBe("notes/only.md");
    expect(item.fromPath).toBeUndefined();
  });

  it("caps the merged feed at the limit", () => {
    const changes = Array.from({ length: 5 }, (_, i) =>
      change({ id: `c${i}`, detectedAt: `2026-07-1${i}T00:00:00.000Z` }),
    );
    const items = buildRecentActivity(changes, [], 3);
    expect(items).toHaveLength(3);
    expect(items[0].id).toBe("c4");
  });
});
