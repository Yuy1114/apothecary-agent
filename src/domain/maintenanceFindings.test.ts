import { describe, expect, it } from "vitest";
import { buildMaintenanceFindings } from "./maintenanceFindings.js";
import type { CanonicalCandidate } from "./canonicalCandidates.js";

const candidate = (concept: string, files: string[]): CanonicalCandidate => ({
  concept,
  files,
  fileCount: files.length,
  duplicatePairs: 0,
  evolutionPairs: 0,
  score: files.length,
});

describe("buildMaintenanceFindings", () => {
  it("maps superseded notes to archive findings", () => {
    const findings = buildMaintenanceFindings({
      superseded: [{ path: "notes/old.md", supersededBy: "notes/canonical.md" }],
      candidates: [],
    });
    expect(findings).toEqual([
      {
        type: "superseded",
        files: ["notes/old.md"],
        suggestedAction: "archive",
        detail: expect.stringContaining("notes/canonical.md"),
      },
    ]);
  });

  it("maps scattered concepts to canonical_note findings", () => {
    const findings = buildMaintenanceFindings({
      superseded: [],
      candidates: [candidate("Redis", ["a.md", "b.md", "c.md"])],
    });
    expect(findings[0]).toMatchObject({
      type: "scattered",
      files: ["a.md", "b.md", "c.md"],
      suggestedAction: "canonical_note",
    });
  });

  it("lists superseded findings before scattered ones", () => {
    const findings = buildMaintenanceFindings({
      superseded: [{ path: "z.md", supersededBy: "c.md" }],
      candidates: [candidate("X", ["a.md", "b.md", "c.md"])],
    });
    expect(findings.map((f) => f.type)).toEqual(["superseded", "scattered"]);
  });

  it("sorts superseded notes by path and caps scattered findings", () => {
    const findings = buildMaintenanceFindings({
      superseded: [
        { path: "b.md", supersededBy: "x.md" },
        { path: "a.md", supersededBy: "x.md" },
      ],
      candidates: [candidate("C1", ["a", "b", "c"]), candidate("C2", ["d", "e", "f"])],
      maxScattered: 1,
    });
    expect(findings.filter((f) => f.type === "superseded").map((f) => f.files[0])).toEqual(["a.md", "b.md"]);
    expect(findings.filter((f) => f.type === "scattered")).toHaveLength(1);
  });
});
