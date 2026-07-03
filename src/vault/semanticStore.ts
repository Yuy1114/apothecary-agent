import { promises as fs } from "node:fs";
import path from "node:path";
import { getAgentArtifacts } from "../artifacts/agentArtifacts.js";
import { FileSummariesSchema, type FileSummaries, type FileSummary } from "../domain/semantic.js";
import { SemanticGraphSchema, type SemanticGraph } from "../domain/semantic.js";
import { DuplicateReportSchema, type DuplicateReport } from "../domain/duplicateDetection.js";
import { RelationsArtifactSchema, type RelationsArtifact } from "../domain/relations.js";
import {
  CanonicalCandidatesArtifactSchema,
  type CanonicalCandidatesArtifact,
} from "../domain/canonicalCandidates.js";

const FILE = "file-summaries.json";
const GRAPH_FILE = "semantic-graph.json";
const DUPLICATES_FILE = "duplicate-clusters.json";
const RELATIONS_FILE = "relations.json";
const CANONICAL_CANDIDATES_FILE = "canonical-candidates.json";

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

function relationsPath(vaultPath: string): string {
  return path.join(getAgentArtifacts(vaultPath).semanticDir, RELATIONS_FILE);
}

export async function loadRelations(vaultPath: string): Promise<RelationsArtifact> {
  try {
    return RelationsArtifactSchema.parse(JSON.parse(await fs.readFile(relationsPath(vaultPath), "utf8")));
  } catch {
    return { generatedAt: "", relations: [] };
  }
}

export async function saveRelations(vaultPath: string, artifact: RelationsArtifact): Promise<void> {
  const filePath = relationsPath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(artifact, null, 2), "utf8");
}

function canonicalCandidatesPath(vaultPath: string): string {
  return path.join(getAgentArtifacts(vaultPath).semanticDir, CANONICAL_CANDIDATES_FILE);
}

export async function loadCanonicalCandidates(vaultPath: string): Promise<CanonicalCandidatesArtifact> {
  try {
    return CanonicalCandidatesArtifactSchema.parse(
      JSON.parse(await fs.readFile(canonicalCandidatesPath(vaultPath), "utf8")),
    );
  } catch {
    return { generatedAt: "", candidates: [] };
  }
}

export async function saveCanonicalCandidates(
  vaultPath: string,
  artifact: CanonicalCandidatesArtifact,
): Promise<void> {
  const filePath = canonicalCandidatesPath(vaultPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(artifact, null, 2), "utf8");
}

export async function loadDuplicateReport(vaultPath: string): Promise<DuplicateReport> {
  try {
    const raw = await fs.readFile(
      path.join(getAgentArtifacts(vaultPath).semanticDir, DUPLICATES_FILE),
      "utf8",
    );
    return DuplicateReportSchema.parse(JSON.parse(raw));
  } catch {
    return { generatedAt: "", clusters: [] };
  }
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
