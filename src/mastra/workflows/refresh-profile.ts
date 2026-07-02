import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { ensureAgentArtifacts } from "../../artifacts/agentArtifacts.js";
import { loadSummaries, loadGraph, loadDuplicateReport } from "../../vault/semanticStore.js";
import { generateKnowledgeProfile } from "../../application/profile/generateKnowledgeProfile.js";
import { renderKnowledgeProfileMarkdown } from "../../reports/renderKnowledgeProfileMarkdown.js";

const OutputSchema = z.object({
  fileCount: z.number(),
  topics: z.number(),
  concepts: z.number(),
  harmfulDuplicates: z.number(),
});

const resolveVaultStep = createStep({
  id: "resolve-vault",
  inputSchema: z.object({ vaultPath: z.string() }),
  outputSchema: z.object({ vaultPath: z.string() }),
  execute: async ({ inputData }) => ({ vaultPath: await resolveExistingDirectory(inputData.vaultPath) }),
});

const buildStep = createStep({
  id: "build-profile",
  inputSchema: z.object({ vaultPath: z.string() }),
  outputSchema: OutputSchema,
  execute: async ({ inputData }) => {
    const { vaultPath } = inputData;
    const [summaries, graph, dupReport] = await Promise.all([
      loadSummaries(vaultPath),
      loadGraph(vaultPath),
      loadDuplicateReport(vaultPath),
    ]);

    if (Object.keys(summaries).length === 0) {
      throw new Error("Semantic layer is empty. Run the refresh-semantics workflow first.");
    }

    const profile = await generateKnowledgeProfile({ summaries, graph, dupReport });

    const artifacts = await ensureAgentArtifacts(vaultPath);
    await fs.writeFile(
      path.join(artifacts.profileDir, "knowledge-profile.json"),
      JSON.stringify(profile, null, 2),
      "utf8",
    );
    await fs.writeFile(
      path.join(artifacts.profileDir, "knowledge-profile.md"),
      renderKnowledgeProfileMarkdown(profile),
      "utf8",
    );

    return {
      fileCount: profile.stats.fileCount,
      topics: profile.stats.topicCount,
      concepts: profile.stats.conceptCount,
      harmfulDuplicates: profile.stats.duplicates.harmful,
    };
  },
});

export const refreshProfileWorkflow = createWorkflow({
  id: "refresh-profile",
  inputSchema: z.object({ vaultPath: z.string() }),
  outputSchema: OutputSchema,
})
  .then(resolveVaultStep)
  .then(buildStep)
  .commit();
