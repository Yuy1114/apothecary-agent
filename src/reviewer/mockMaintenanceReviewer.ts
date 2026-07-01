import path from "node:path";
import type { MaintenanceFinding, MaintenanceReview } from "../domain/maintenanceReview.js";
import type { VaultScan } from "../domain/vault.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";

export type BuildDeterministicMaintenanceReviewOptions = {
  longContextWordThreshold: number;
  longContextLineThreshold: number;
};

export function buildDeterministicMaintenanceReview(
  scan: VaultScan,
  options: BuildDeterministicMaintenanceReviewOptions,
): MaintenanceReview {
  const findings: MaintenanceFinding[] = [];

  for (const file of scan.files.filter((candidate) => candidate.mediaType === "markdown")) {
    if (
      (file.wordCount ?? 0) > options.longContextWordThreshold ||
      (file.lineCount ?? 0) > options.longContextLineThreshold
    ) {
      findings.push({
        id: createId("finding"),
        type: "long_context",
        severity: "medium",
        filePaths: [file.path],
        observation: "This Markdown file is large enough to be expensive to re-read when returning to the topic.",
        whyItMatters: "Long context files increase recall cost and may benefit from a generated context summary.",
        suggestion: "Review whether this file needs a short topic summary or index note.",
        relatedFiles: [],
        confidence: 0.6,
      });
    }

    if (isLikelyAiOutput(file.path)) {
      findings.push({
        id: createId("finding"),
        type: "unassimilated_ai_output",
        severity: "medium",
        filePaths: [file.path],
        observation: "This file path suggests AI-generated or output material.",
        whyItMatters: "AI outputs often remain as temporary artifacts unless durable insights are absorbed into project or concept notes.",
        suggestion: "Check whether this output contains decisions, concepts, or project context worth integrating later.",
        relatedFiles: [],
        confidence: 0.45,
      });
    }

    if (path.basename(file.path).toLowerCase().includes("untitled")) {
      findings.push({
        id: createId("finding"),
        type: "unclear_location",
        severity: "low",
        filePaths: [file.path],
        observation: "The file name suggests this note may not have a stable title yet.",
        whyItMatters: "Unclear note names make later recall and topic grouping harder.",
        suggestion: "Manually review whether the note needs a clearer title or topic assignment.",
        relatedFiles: [],
        confidence: 0.5,
      });
    }
  }

  return {
    id: createId("review"),
    vaultPath: scan.vaultPath,
    scopePath: scan.scopePath,
    generatedAt: nowIso(),
    basedOnScanId: scan.id,
    findings,
    summary: `Found ${findings.length} maintenance finding(s) from ${scan.stats.markdownFiles} markdown file(s).`,
  };
}

function isLikelyAiOutput(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.includes("output") || lower.includes("ai-generated") || lower.includes("chatgpt") || lower.includes("claude");
}
