import type { FindingSeverity, MaintenanceFinding, MaintenanceFindingType, MaintenanceReview } from "../domain/maintenanceReview.js";

const FINDING_TYPE_PRIORITY: Record<MaintenanceFindingType, number> = {
  missing_index: 0,
  stale_note: 1,
  unassimilated_ai_output: 2,
  duplicate_topic: 3,
  long_context: 4,
  superficial_note: 5,
  orphan_note: 6,
  unclear_location: 7,
};

const SEVERITY_PRIORITY: Record<FindingSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function normalizeMaintenanceReview(review: MaintenanceReview): MaintenanceReview {
  const findings = sortFindings(dedupeFindings(review.findings));
  return {
    ...review,
    findings,
    summary: buildReviewSummary(findings),
  };
}

function dedupeFindings(findings: MaintenanceFinding[]): MaintenanceFinding[] {
  const seen = new Set<string>();
  const result: MaintenanceFinding[] = [];

  for (const finding of findings) {
    const key = [finding.type, [...finding.filePaths].sort().join("|")].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(finding);
  }

  return result;
}

function sortFindings(findings: MaintenanceFinding[]): MaintenanceFinding[] {
  return [...findings].sort((a, b) => {
    const typeDiff = FINDING_TYPE_PRIORITY[a.type] - FINDING_TYPE_PRIORITY[b.type];
    if (typeDiff !== 0) return typeDiff;

    const severityDiff = SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity];
    if (severityDiff !== 0) return severityDiff;

    return firstFilePath(a).localeCompare(firstFilePath(b));
  });
}

function buildReviewSummary(findings: MaintenanceFinding[]): string {
  if (findings.length === 0) return "Found 0 maintenance findings.";

  const counts = countFindingsByType(findings);
  const countLines = [...counts.entries()].map(([type, count]) => `- ${type}: ${count}`);

  return [`Found ${findings.length} maintenance finding(s).`, "", "Top issues:", ...countLines].join("\n");
}

function countFindingsByType(findings: MaintenanceFinding[]): Map<MaintenanceFindingType, number> {
  const counts = new Map<MaintenanceFindingType, number>();
  for (const finding of findings) {
    counts.set(finding.type, (counts.get(finding.type) ?? 0) + 1);
  }
  return new Map([...counts.entries()].sort(([a], [b]) => FINDING_TYPE_PRIORITY[a] - FINDING_TYPE_PRIORITY[b]));
}

function firstFilePath(finding: MaintenanceFinding): string {
  return finding.filePaths[0] ?? "";
}
