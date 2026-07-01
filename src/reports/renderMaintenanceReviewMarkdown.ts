import type { MaintenanceFinding, MaintenanceReview } from "../domain/maintenanceReview.js";

export function renderMaintenanceReviewMarkdown(review: MaintenanceReview): string {
  return [
    "# Vault Maintenance Review",
    "",
    `Generated: ${review.generatedAt}`,
    `Vault: ${review.vaultPath}`,
    review.scopePath ? `Scope: ${review.scopePath}` : undefined,
    "",
    "## Summary",
    "",
    review.summary,
    "",
    "## Findings",
    "",
    renderGroupedFindings(review.findings),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function renderGroupedFindings(findings: MaintenanceFinding[]): string {
  if (findings.length === 0) return "No findings.";

  let globalIndex = 1;
  return [...groupFindingsByType(findings).entries()]
    .map(([type, typeFindings]) =>
      [
        `### ${type}`,
        "",
        typeFindings.map((finding) => renderFinding(finding, globalIndex++)).join("\n\n"),
      ].join("\n"),
    )
    .join("\n\n");
}

function renderFinding(finding: MaintenanceFinding, index: number): string {
  return [
    `#### ${index}. ${primaryFindingTarget(finding)} (${finding.severity})`,
    "",
    `Confidence: ${finding.confidence}`,
    "",
    "##### Files",
    ...finding.filePaths.map((file) => `- \`${file}\``),
    "",
    "##### Observation",
    finding.observation,
    "",
    "##### Why it matters",
    finding.whyItMatters,
    "",
    "##### Suggestion",
    finding.suggestion,
  ].join("\n");
}

function groupFindingsByType(findings: MaintenanceFinding[]): Map<string, MaintenanceFinding[]> {
  const groups = new Map<string, MaintenanceFinding[]>();
  for (const finding of findings) {
    const current = groups.get(finding.type) ?? [];
    current.push(finding);
    groups.set(finding.type, current);
  }
  return groups;
}

function primaryFindingTarget(finding: MaintenanceFinding): string {
  if (finding.filePaths.length === 1) return finding.filePaths[0] ?? finding.type;
  return `${finding.filePaths.length} files`;
}
