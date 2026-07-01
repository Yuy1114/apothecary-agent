import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import path from "node:path";
import { writeJsonArtifact, writeMarkdownArtifact } from "../../artifacts/writeAgentArtifact.js";
import { KnowledgeMapSchema } from "../../domain/knowledgeMap.js";
import { VaultScanSchema } from "../../domain/vault.js";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { scanVault } from "../../vault/scanner.js";
import { ensureAgentWorkspace } from "../../workspace/agentWorkspace.js";
import { buildKnowledgeMapContext } from "../../reviewer/buildReviewerContext.js";
import { createReviewerModel } from "../../reviewer/createReviewerModel.js";
import { renderKnowledgeMapMarkdown } from "../../reports/renderKnowledgeMapMarkdown.js";

// ── Steps ──

const resolveVaultStep = createStep({
  id: "resolve-vault",
  inputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional() }),
  outputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional() }),
  execute: async ({ inputData }) => {
    const vaultPath = await resolveExistingDirectory(inputData.vaultPath);
    return { vaultPath, scopePath: inputData.scopePath };
  },
});

const scanStep = createStep({
  id: "scan",
  inputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional() }),
  outputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional(), scanId: z.string() }),
  execute: async ({ inputData }) => {
    const workspace = await ensureAgentWorkspace(inputData.vaultPath);
    const scan = VaultScanSchema.parse(await scanVault({
      vaultPath: inputData.vaultPath,
      scopePath: inputData.scopePath,
      includeHash: false,
      ignore: [".agent/**", ".apothecary/**", ".obsidian/**", ".trash/**"],
    }));
    return { ...inputData, scanId: scan.id, _scan: scan, _workspace: workspace };
  },
});

const mapStep = createStep({
  id: "agent-map",
  inputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional(), scanId: z.string() }),
  outputSchema: z.object({
    jsonPath: z.string(),
    markdownPath: z.string(),
    mapJson: z.string(),
    mapMd: z.string(),
  }),
  execute: async ({ inputData }) => {
    const scan = (inputData as any)._scan;
    const workspace = (inputData as any)._workspace;
    const context = buildKnowledgeMapContext(scan, {
      maxFiles: 20,
      minSizeBytes: 100,
    });
    const reviewer = createReviewerModel();
    const map = KnowledgeMapSchema.parse(
      await reviewer.generateKnowledgeMap({
        context,
        options: { maxTopics: 10, maxFilesPerTopic: 8 },
      }),
    );
    const jsonPath = path.join(workspace.mapsDir, "knowledge-map.json");
    const markdownPath = path.join(workspace.mapsDir, "knowledge-map.md");
    const mapMd = renderKnowledgeMapMarkdown(map);

    await writeJsonArtifact({ workspace, artifactPath: jsonPath, value: map });
    await writeMarkdownArtifact({ workspace, artifactPath: markdownPath, content: mapMd });

    return { jsonPath, markdownPath, mapJson: JSON.stringify(map), mapMd };
  },
});

// ── Workflow ──

export const mapWorkflow = createWorkflow({
  id: "map",
  inputSchema: z.object({ vaultPath: z.string(), scopePath: z.string().optional() }),
  outputSchema: z.object({
    jsonPath: z.string(),
    markdownPath: z.string(),
    mapJson: z.string(),
    mapMd: z.string(),
  }),
})
  .then(resolveVaultStep)
  .then(scanStep)
  .then(mapStep)
  .commit();
