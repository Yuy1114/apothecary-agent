import { assembleViewFiles, type KnowledgeView } from "../../domain/knowledgeView.js";
import { loadGraph, loadSummaries } from "../../vault/semanticStore.js";
import { searchIndex } from "../ports/searchIndex.js";
import type { KnowledgeViewWriter, ViewEvidence } from "../ports/knowledgeViewWriter.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";

const MAX_FILES = 25;

export async function generateKnowledgeView(
  topic: string,
  writer: KnowledgeViewWriter,
): Promise<KnowledgeView> {
  const home = apothecaryHome();
  const [graph, summaries] = await Promise.all([loadGraph(home), loadSummaries(home)]);

  // Graph match, plus a RAG fallback so a fragmented graph doesn't miss files.
  const fromGraph = assembleViewFiles(graph, topic);
  const fromRag = (await searchIndex().queryVault(topic, 8)).map((r) => r.source);
  const sourceFiles = [...new Set([...fromGraph, ...fromRag])]
    .filter((path) => summaries[path])
    .slice(0, MAX_FILES);

  const evidence: ViewEvidence[] = sourceFiles.map((path) => {
    const s = summaries[path];
    return { path, gist: s.gist, topics: s.topics, concepts: s.concepts };
  });

  const draft = await writer.write({ topic, evidence });

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
