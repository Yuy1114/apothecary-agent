import { describe, expect, it } from "vitest";
import {
  ProposalSchema,
  deriveTargetFiles,
  resolveProposalRecord,
  type Proposal,
} from "./proposal.js";

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return ProposalSchema.parse({
    id: "prop-1",
    type: "edit",
    status: "proposed",
    title: "t",
    rationale: "r",
    payload: { filePath: "notes/a.md", suggestedContent: "x" },
    targetFiles: ["notes/a.md"],
    createdAt: "2026-07-03T00:00:00.000Z",
    ...overrides,
  });
}

describe("deriveTargetFiles", () => {
  it("derives files per proposal type", () => {
    expect(deriveTargetFiles({ type: "edit", payload: { filePath: "a.md", suggestedContent: "" } })).toEqual(["a.md"]);
    expect(deriveTargetFiles({ type: "move", payload: { from: "a.md", to: "b.md" } })).toEqual(["a.md", "b.md"]);
    expect(deriveTargetFiles({ type: "archive", payload: { from: "a.md" } })).toEqual(["a.md"]);
    expect(
      deriveTargetFiles({
        type: "merge",
        payload: { sourcePath: "a.md", canonicalPath: "b.md", canonicalContent: "c" },
      }),
    ).toEqual(["a.md", "b.md"]);
  });

  it("derives files for the knowledge-entry types", () => {
    expect(deriveTargetFiles({ type: "capture", payload: { content: "x", topic: "reflections/" } })).toEqual([
      "reflections/",
    ]);
    expect(deriveTargetFiles({ type: "capture", payload: { content: "x" } })).toEqual([]);
    expect(deriveTargetFiles({ type: "structure", payload: { directory: "notes/db/" } })).toEqual(["notes/db/"]);
    expect(
      deriveTargetFiles({
        type: "view_promotion",
        payload: { sourceViewPath: ".agent/views/x.md", targetPath: "notes/x.md", content: "c" },
      }),
    ).toEqual([".agent/views/x.md", "notes/x.md"]);
    expect(
      deriveTargetFiles({
        type: "canonical_note",
        payload: { canonicalPath: "notes/c.md", content: "c", supersedes: ["a.md", "b.md"] },
      }),
    ).toEqual(["notes/c.md", "a.md", "b.md"]);
  });
});

describe("ProposalSchema", () => {
  it("rejects a payload that does not match its type", () => {
    expect(() =>
      ProposalSchema.parse({
        id: "p",
        type: "move",
        status: "proposed",
        title: "t",
        rationale: "",
        payload: { filePath: "a.md" }, // edit-shaped payload on a move
        targetFiles: [],
        createdAt: "now",
      }),
    ).toThrow();
  });
});

describe("resolveProposalRecord", () => {
  it("stamps an applied decision", () => {
    const resolved = resolveProposalRecord(proposal(), "applied", "looks good", "2026-07-03T01:00:00.000Z");
    expect(resolved).toMatchObject({
      status: "applied",
      resolvedAt: "2026-07-03T01:00:00.000Z",
      resolutionNote: "looks good",
    });
  });

  it("stamps a rejected decision", () => {
    const resolved = resolveProposalRecord(proposal(), "rejected", "not needed", "2026-07-03T01:00:00.000Z");
    expect(resolved.status).toBe("rejected");
  });

  it("refuses to resolve an already-resolved proposal", () => {
    const applied = proposal({ status: "applied" });
    expect(() => resolveProposalRecord(applied, "rejected", undefined, "now")).toThrow(/already applied/);
  });
});
