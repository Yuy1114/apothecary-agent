import { stringify } from "yaml";

export const defaultProtocolMarkdown = `# Personal Knowledge Protocol

This protocol tells apothecary-agent how this vault should be reviewed.

## Purpose

This vault stores Yuy's personal knowledge, project notes, learning notes, reflections, and AI-assisted thinking.

## v0.1 Reviewer Boundary

apothecary-agent v0.1 is read-only for user notes.

Allowed:

- read Markdown files;
- scan metadata;
- generate \`.agent/\` maps, reviews, metadata, and logs.

Blocked:

- moving user files;
- renaming user files;
- deleting user files;
- rewriting user notes;
- modifying user note frontmatter.

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
  reviewer_boundary: {
    read_user_notes: true,
    write_agent_artifacts: true,
    modify_user_notes: false,
    move_files: false,
    delete_files: false,
    rename_files: false,
  },
  review_priorities: [
    "stale_note",
    "long_context",
    "unassimilated_ai_output",
    "orphan_note",
    "missing_index",
  ],
});
