import type { KnowledgeMap } from "../domain/knowledgeMap.js";

export function renderKnowledgeMapMarkdown(map: KnowledgeMap): string {
  const topics = map.topics
    .map((topic) => {
      const files = topic.relatedFiles
        .map((file) => `- \`${file.path}\` — ${file.summary} _(role: ${file.role})_`)
        .join("\n");
      const concepts = topic.keyConcepts.length > 0 ? topic.keyConcepts.map((concept) => `\`${concept}\``).join(", ") : "None yet";

      return [`## ${topic.title}`, "", topic.summary, "", `Category: ${topic.category}`, `Confidence: ${topic.confidence}`, `Key concepts: ${concepts}`, "", "### Related files", files || "- none"].join("\n");
    })
    .join("\n\n");

  return [`# Knowledge Map`, "", `Generated: ${map.generatedAt}`, `Vault: ${map.vaultPath}`, "", map.summary, "", topics].join("\n");
}


