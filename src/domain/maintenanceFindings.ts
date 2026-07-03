import { z } from "zod";
import type { CanonicalCandidate } from "./canonicalCandidates.js";

/**
 * A prioritized maintenance to-do derived deterministically from the semantic
 * artifacts, each mapped to the proposal that would resolve it. Gives the
 * curator one worklist instead of cross-referencing duplicates/candidates/
 * relations by hand.
 */
export const MaintenanceFindingSchema = z.object({
  type: z.enum(["superseded", "scattered"]),
  files: z.array(z.string()),
  suggestedAction: z.enum(["archive", "canonical_note"]),
  detail: z.string(),
});
export type MaintenanceFinding = z.infer<typeof MaintenanceFindingSchema>;

export type SupersededNote = { path: string; supersededBy: string };

/**
 * Build the maintenance findings. `superseded` notes (still active but stamped
 * with a `superseded_by` link) come first — a concrete archive action — then
 * `scattered` concepts (canonical candidates) worth a canonical note, highest
 * priority first. Pure.
 */
export function buildMaintenanceFindings(input: {
  superseded: SupersededNote[];
  candidates: CanonicalCandidate[];
  maxScattered?: number;
}): MaintenanceFinding[] {
  const findings: MaintenanceFinding[] = [];

  for (const note of [...input.superseded].sort((a, b) => a.path.localeCompare(b.path))) {
    findings.push({
      type: "superseded",
      files: [note.path],
      suggestedAction: "archive",
      detail: `Superseded by ${note.supersededBy} but still active — archive it once fully absorbed.`,
    });
  }

  for (const candidate of input.candidates.slice(0, input.maxScattered ?? 10)) {
    findings.push({
      type: "scattered",
      files: candidate.files,
      suggestedAction: "canonical_note",
      detail: `Concept "${candidate.concept}" is spread across ${candidate.fileCount} notes — consider a canonical note.`,
    });
  }

  return findings;
}
