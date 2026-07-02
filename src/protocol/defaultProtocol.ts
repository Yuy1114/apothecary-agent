import { stringify } from "yaml";
import { PERMISSION_DECISION_MEANINGS, VAULT_PERMISSION_POLICY } from "../domain/permissionPolicy.js";

const REVIEW_PRIORITIES = [
  "stale_note",
  "long_context",
  "unassimilated_ai_output",
  "orphan_note",
  "missing_index",
] as const;

export const defaultProtocolMarkdown = `# Personal Knowledge Protocol

This protocol tells apothecary-agent how this vault should be maintained.

## Purpose

This vault stores Yuy's personal knowledge, project notes, learning notes, reflections, and AI-assisted thinking.

## Permission Policy

The agent follows a three-level permission policy:

- \`allow\`: allowed without human approval.
- \`ask\`: requires human approval before execution or persistence.
- \`deny\`: not allowed for this agent runtime.

Current policy:

| Action | Decision |
| --- | --- |
| Read user vault content | \`${VAULT_PERMISSION_POLICY.readVault}\` |
| Write agent-owned \`.agent/\` artifacts | \`${VAULT_PERMISSION_POLICY.writeAgentArtifact}\` |
| Propose user note changes | \`${VAULT_PERMISSION_POLICY.proposeUserNoteChange}\` |
| Persist maintenance review artifact | \`${VAULT_PERMISSION_POLICY.persistMaintenanceReview}\` |
| Write user notes | \`${VAULT_PERMISSION_POLICY.writeUserNote}\` |
| Move user files | \`${VAULT_PERMISSION_POLICY.moveUserFile}\` |
| Delete user files | \`${VAULT_PERMISSION_POLICY.deleteUserFile}\` |
| Execute shell commands | \`${VAULT_PERMISSION_POLICY.executeCommand}\` |

## Operational Rules

- Reading, scanning, indexing, and semantic retrieval are allowed.
- Agent-owned artifacts under \`.agent/\` may be written by default.
- Maintenance review persistence is approval-gated because it records a user-visible judgement artifact.
- Proposed edits are allowed, but applying those edits to user notes is approval-gated.
- Moving user files is approval-gated.
- Deleting user files and executing shell commands are denied.

## Review Priorities

When reviewing the vault, prioritize:

1. stale notes that may contain durable insights;
2. long context files that are expensive to re-read;
3. AI-generated outputs that have not been assimilated;
4. orphan notes without clear topic context;
5. missing project or topic entry points.
`;

export const defaultProtocolYaml = stringify({
  vault_purpose: "Yuy's personal knowledge, project notes, learning notes, reflections, and AI-assisted thinking.",
  permission_policy: VAULT_PERMISSION_POLICY,
  permission_decision_meanings: PERMISSION_DECISION_MEANINGS,
  operational_rules: [
    "Reading, scanning, indexing, and semantic retrieval are allowed.",
    "Agent-owned artifacts under .agent/ may be written by default.",
    "Maintenance review persistence is approval-gated because it records a user-visible judgement artifact.",
    "Proposed edits are allowed, but applying those edits to user notes is approval-gated.",
    "Moving user files is approval-gated.",
    "Deleting user files and executing shell commands are denied.",
  ],
  review_priorities: REVIEW_PRIORITIES,
});
