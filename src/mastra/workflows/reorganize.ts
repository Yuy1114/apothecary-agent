import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import path from "node:path";
import { VaultScanSchema } from "../../domain/vault.js";
import { resolveExistingDirectory } from "../../safety/pathSafety.js";
import { scanVault } from "../../vault/scanner.js";
import { ensureAgentArtifacts } from "../../artifacts/agentArtifacts.js";
import { writeJsonArtifact } from "../../artifacts/writeAgentArtifact.js";
import { timestampForFile } from "../../utils/time.js";
import { loadStructure } from "../tools/vault-structure.js";
import { planReorg } from "../../domain/reorgPlan.js";
import { moveVaultFileCore } from "../tools/move-vault-file-core.js";

const ReorgMoveSchema = z.object({ from: z.string(), to: z.string() });

const PlanStateSchema = z.object({
  vaultPath: z.string(),
  planJson: z.string(),
  movesCount: z.number(),
  collisionsCount: z.number(),
  unclassifiedCount: z.number(),
  unchangedCount: z.number(),
  reportPath: z.string(),
});

const OutputSchema = z.object({
  approved: z.boolean(),
  movedCount: z.number(),
  skippedCount: z.number(),
  reportPath: z.string(),
});

const resolveVaultStep = createStep({
  id: "resolve-vault",
  inputSchema: z.object({ vaultPath: z.string() }),
  outputSchema: z.object({ vaultPath: z.string() }),
  execute: async ({ inputData }) => ({
    vaultPath: await resolveExistingDirectory(inputData.vaultPath),
  }),
});

const scanStep = createStep({
  id: "scan",
  inputSchema: z.object({ vaultPath: z.string() }),
  outputSchema: z.object({ vaultPath: z.string(), scan: VaultScanSchema }),
  execute: async ({ inputData }) => {
    const scan = VaultScanSchema.parse(
      await scanVault({
        vaultPath: inputData.vaultPath,
        includeHash: false,
        ignore: [".agent/**", ".apothecary/**", ".obsidian/**", ".trash/**"],
      }),
    );
    return { vaultPath: inputData.vaultPath, scan };
  },
});

const planStep = createStep({
  id: "plan-reorg",
  inputSchema: z.object({ vaultPath: z.string(), scan: VaultScanSchema }),
  outputSchema: PlanStateSchema,
  execute: async ({ inputData }) => {
    const structure = await loadStructure();
    const plan = planReorg(inputData.scan.files, structure);

    const artifacts = await ensureAgentArtifacts(inputData.vaultPath);
    const reportPath = path.join(artifacts.metadataDir, `reorg-plan-${timestampForFile()}.json`);
    await writeJsonArtifact({
      artifacts,
      artifactPath: reportPath,
      value: { generatedAt: new Date().toISOString(), basedOnScanId: inputData.scan.id, ...plan },
    });

    return {
      vaultPath: inputData.vaultPath,
      planJson: JSON.stringify(plan),
      movesCount: plan.moves.length,
      collisionsCount: plan.collisions.length,
      unclassifiedCount: plan.unclassified.length,
      unchangedCount: plan.unchangedCount,
      reportPath,
    };
  },
});

const requestApprovalStep = createStep({
  id: "request-reorg-approval",
  inputSchema: PlanStateSchema,
  outputSchema: PlanStateSchema.extend({ approved: z.boolean() }),
  suspendSchema: z.object({
    reason: z.string(),
    movesCount: z.number(),
    collisionsCount: z.number(),
    unclassifiedCount: z.number(),
    unchangedCount: z.number(),
    reportPath: z.string(),
    preview: z.string(),
    previewTruncated: z.boolean(),
  }),
  resumeSchema: z.object({ approved: z.boolean() }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      const moves = z.array(ReorgMoveSchema).parse(JSON.parse(inputData.planJson).moves);
      const previewLimit = 30;
      const preview = moves
        .slice(0, previewLimit)
        .map((m) => `${m.from}  →  ${m.to}`)
        .join("\n");
      return await suspend({
        reason: "Human approval required before moving vault files in bulk.",
        movesCount: inputData.movesCount,
        collisionsCount: inputData.collisionsCount,
        unclassifiedCount: inputData.unclassifiedCount,
        unchangedCount: inputData.unchangedCount,
        reportPath: inputData.reportPath,
        preview,
        previewTruncated: moves.length > previewLimit,
      });
    }
    return { ...inputData, approved: resumeData.approved };
  },
});

const executeStep = createStep({
  id: "execute-reorg",
  inputSchema: PlanStateSchema.extend({ approved: z.boolean() }),
  outputSchema: OutputSchema,
  execute: async ({ inputData }) => {
    if (!inputData.approved) {
      return { approved: false, movedCount: 0, skippedCount: 0, reportPath: inputData.reportPath };
    }

    const moves = z.array(ReorgMoveSchema).parse(JSON.parse(inputData.planJson).moves);
    let movedCount = 0;
    let skippedCount = 0;
    for (const move of moves) {
      const result = await moveVaultFileCore(move.from, move.to);
      if (result.moved) movedCount += 1;
      else skippedCount += 1;
    }

    return { approved: true, movedCount, skippedCount, reportPath: inputData.reportPath };
  },
});

export const reorganizeWorkflow = createWorkflow({
  id: "reorganize",
  inputSchema: z.object({ vaultPath: z.string() }),
  outputSchema: OutputSchema,
})
  .then(resolveVaultStep)
  .then(scanStep)
  .then(planStep)
  .then(requestApprovalStep)
  .then(executeStep)
  .commit();
