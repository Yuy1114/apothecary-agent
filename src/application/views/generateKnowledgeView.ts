import { knowledgeViewWriter } from "../../mastra/agents/transformers/knowledge-view-writer.js";
import { KnowledgeViewDraftSchema, assembleViewFiles, type KnowledgeView } from "../../domain/knowledgeView.js";
import { loadGraph, loadSummaries } from "../../vault/semanticStore.js";
import { searchIndex } from "../ports/searchIndex.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";

const MAX_FILES = 25;

export async function generateKnowledgeView(topic: string): Promise<KnowledgeView> {
  const home = apothecaryHome();
  const [graph, summaries] = await Promise.all([loadGraph(home), loadSummaries(home)]);

  // Graph match, plus a RAG fallback so a fragmented graph doesn't miss files.
  const fromGraph = assembleViewFiles(graph, topic);
  const fromRag = (await searchIndex().queryVault(topic, 8)).map((r) => r.source);
  const sourceFiles = [...new Set([...fromGraph, ...fromRag])]
    .filter((path) => summaries[path])
    .slice(0, MAX_FILES);

  const evidence = sourceFiles
    .map((path) => {
      const s = summaries[path];
      return `- ${path}: ${s.gist} [topics: ${s.topics.join(", ")}; concepts: ${s.concepts.join(", ")}]`;
    })
    .join("\n");

  const prompt = [
    `Topic: ${topic}`,
    "",
    "Per-file summaries (evidence):",
    evidence || "(no matching files found in the semantic layer)",
    "",
    "Build the knowledge-system view for this topic from the evidence above. Output ONLY the structured fields.",
  ].join("\n");

  const result = await knowledgeViewWriter.generate(prompt, {
    maxSteps: 1,
    toolChoice: "none",
    structuredOutput: { schema: KnowledgeViewDraftSchema, jsonPromptInjection: "system" },
  });

  const draft = result.object;
  if (!draft) {
    throw new Error(`View writer returned no structured output (finishReason=${result.finishReason}).`);
  }

  return {
    topic,
    generatedAt: new Date().toISOString(),
    overview: draft.overview,
    coreTopics: draft.coreTopics,
    keyConcepts: draft.keyConcepts,
    gaps: draft.gaps,
    readingOrder: draft.readingOrder,
    sourceFiles,
  };
}
