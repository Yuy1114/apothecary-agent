import { describe, expect, it } from "vitest";
import type { MaintenanceFinding, MaintenanceReview } from "../domain/maintenanceReview.js";
import { normalizeMaintenanceReview } from "./normalizeMaintenanceReview.js";

describe("normalizeMaintenanceReview", () => {
  it("deduplicates, sorts, and summarizes findings", () => {
    const review = makeReview([
      makeFinding("long_context", "medium", ["b.md"]),
      makeFinding("orphan_note", "low", ["z.md"]),
      makeFinding("missing_index", "medium", ["a.md", "b.md"]),
      makeFinding("long_context", "medium", ["b.md"]),
    ]);

    const normalized = normalizeMaintenanceReview(review);

    expect(normalized.findings.map((finding) => finding.type)).toEqual(["missing_index", "long_context", "orphan_note"]);
    expect(normalized.findings.map((finding) => finding.filePaths)).toEqual([["a.md", "b.md"], ["b.md"], ["z.md"]]);
    expect(normalized.summary).toBe([
      "Found 3 maintenance finding(s).",
      "",
      "Top issues:",
      "- missing_index: 1",
      "- long_context: 1",
      "- orphan_note: 1",
    ].join("\n"));
  });
});

function makeReview(findings: MaintenanceFinding[]): MaintenanceReview {
  return {
    id: "review-test",
    vaultPath: "/tmp/vault",
    generatedAt: "2026-07-01T00:00:00.000Z",
    basedOnScanId: "scan-test",
    findings,
    summary: "raw summary",
  };
}

function makeFinding(
  type: MaintenanceFinding["type"],
  severity: MaintenanceFinding["severity"],
  filePaths: string[],
): MaintenanceFinding {
  return {
    id: `finding-${type}-${filePaths.join("-")}`,
    type,
    severity,
    filePaths,
    observation: `${type} observation`,
    whyItMatters: `${type} why`,
    suggestion: `${type} suggestion`,
    relatedFiles: [],
    confidence: 0.5,
  };
}
