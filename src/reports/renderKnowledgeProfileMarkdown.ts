import type { KnowledgeProfile } from "../domain/knowledgeProfile.js";

function bullets(items: string[]): string {
  return items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : "- (none)";
}

export function renderKnowledgeProfileMarkdown(profile: KnowledgeProfile): string {
  const s = profile.stats;
  return [
    "# Knowledge Profile",
    "",
    `_generated ${profile.generatedAt}_`,
    "",
    "## Overview",
    "",
    profile.overview || "(none)",
    "",
    "## Snapshot",
    "",
    `- Files: ${s.fileCount} · Topics: ${s.topicCount} · Concepts: ${s.conceptCount}`,
    `- Duplicates: harmful ${s.duplicates.harmful}, contextual ${s.duplicates.contextual}, evolutionary ${s.duplicates.evolutionary}`,
    "",
    "### By directory",
    "",
    bullets(s.byDirectory.map((d) => `${d.dir} — ${d.fileCount}`)),
    "",
    "### Top topics",
    "",
    bullets(s.topTopics.map((t) => `${t.label} — ${t.fileCount}`)),
    "",
    "### Top concepts",
    "",
    bullets(s.topConcepts.map((c) => `${c.label} — ${c.fileCount}`)),
    "",
    "## Active projects",
    "",
    bullets(profile.activeProjects),
    "",
    "## Evidence areas",
    "",
    bullets(profile.evidenceAreas),
    "",
    "## Weak / thin areas",
    "",
    bullets(profile.weakAreas),
    "",
    "## Recommendations",
    "",
    bullets(profile.recommendations),
    "",
  ].join("\n");
}
