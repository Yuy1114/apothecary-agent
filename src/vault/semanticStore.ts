import { promises as fs } from "node:fs";
import path from "node:path";
import { getAgentArtifacts } from "../artifacts/agentArtifacts.js";
import { FileSummariesSchema, type FileSummaries, type FileSummary } from "../domain/semantic.js";
import { SemanticGraphSchema, type SemanticGraph } from "../domain/semantic.js";

const FILE = "file-summaries.json";
const GRAPH_FILE = "semantic-graph.json";

function summariesPath(vaultPath: string): string {
  return path.join(getAgentArtifacts(vaultPath).semanticDir, FILE);
}

function graphPath(vaultPath: string): string {
  return path.join(getAgentArtifacts(vaultPath).semanticDir, GRAPH_FILE);
}

const EMPTY_GRAPH: SemanticGraph = { generatedAt: "", topics: [], concepts: [] };

export async function loadGraph(vaultPath: string): Promise<SemanticGraph> {
  try {
    const raw = await fs.readFile(graphPath(vaultPath), "utf8");
    return SemanticGraphSchema.parse(JSON.parse(raw));
  } catch {
    return EMPTY_GRAPH;
  }
}

export async function saveGraph(vaultPath: string, graph: SemanticGraph): Promise<void> {
  const filePath = graphPath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(graph, null, 2), "utf8");
}

export async function loadSummaries(vaultPath: string): Promise<FileSummaries> {
  try {
    const raw = await fs.readFile(summariesPath(vaultPath), "utf8");
    return FileSummariesSchema.parse(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function saveSummaries(vaultPath: string, summaries: FileSummaries): Promise<void> {
  const filePath = summariesPath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(summaries, null, 2), "utf8");
}

/** A file needs a fresh summary when it is new or its content hash changed. */
export function needsRefresh(
  summaries: FileSummaries,
  path: string,
  contentHash: string,
): boolean {
  const existing = summaries[path];
  return !existing || existing.contentHash !== contentHash;
}

export function upsertSummary(summaries: FileSummaries, summary: FileSummary): FileSummaries {
  return { ...summaries, [summary.path]: summary };
}

/** Drop summaries whose file no longer exists. Returns the pruned map and count. */
export function pruneMissing(
  summaries: FileSummaries,
  existingPaths: Iterable<string>,
): { summaries: FileSummaries; pruned: number } {
  const keep = new Set(existingPaths);
  const next: FileSummaries = {};
  let pruned = 0;
  for (const [p, summary] of Object.entries(summaries)) {
    if (keep.has(p)) next[p] = summary;
    else pruned += 1;
  }
  return { summaries: next, pruned };
}
