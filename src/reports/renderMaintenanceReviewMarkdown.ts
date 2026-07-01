import type { MaintenanceReview } from "../domain/maintenanceReview.js";

export function renderMaintenanceReviewMarkdown(review: MaintenanceReview): string {
  const findings = review.findings
    .map((finding, index) =>
      [
        `## ${index + 1}. ${finding.type} (${finding.severity})`,
        "",
        `Confidence: ${finding.confidence}`,
        "",
        "### Files",
        ...finding.filePaths.map((file) => `- \`${file}\``),
        "",
        "### Observation",
        finding.observation,
        "",
        "### Why it matters",
        finding.whyItMatters,
        "",
        "### Suggestion",
        finding.suggestion,
      ].join("\n"),
    )
    .join("\n\n");

  return ["# Vault Maintenance Review", "", `Generated: ${review.generatedAt}`, `Vault: ${review.vaultPath}`, "", review.summary, "", findings || "No findings."].join("\n");
}
