import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import path from "node:path";

import { scanVaultTool } from "../tools/scan-vault.js";
import { readMarkdownTool } from "../tools/read-markdown.js";
import { writeReviewTool } from "../tools/write-review.js";
import { queryVaultTool } from "../tools/query-vault.js";
import { proposeEditTool } from "../tools/propose-edit.js";
import { ingestVaultTool } from "../tools/ingest-vault.js";
import { moveVaultFileTool } from "../tools/move-vault-file.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";
const DB_PATH = `file:${path.join(VAULT_PATH, ".agent", "memory.db")}`;

const deepseek = createOpenAICompatible({
  name: "deepseek",
  baseURL: (process.env.APOTHECARY_OPENAI_BASE_URL ?? "https://api.deepseek.com") + "/v1",
  apiKey: process.env.APOTHECARY_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
});

const memory = new Memory({
  storage: new LibSQLStore({ id: "apothecary-memory", url: DB_PATH }),
  options: {
    lastMessages: 20,
    observationalMemory: true,
  },
});

export const vaultReviewer = new Agent({
  id: "vault-reviewer",
  name: "Vault Reviewer",
  description:
    "Read-only vault reviewer that produces knowledge maps, maintenance reviews, answers questions, and proposes edits.",
  instructions:
    "You are apothecary-agent, a personal knowledge maintenance assistant for Yuy's vault. " +
    "Use tools to scan, read, search, review, and propose edits. " +
    "Answer in Chinese when the user writes Chinese. Be concise.",
  model: deepseek("deepseek-chat"),
  memory,
  tools: {
    scanVault: scanVaultTool,
    readMarkdown: readMarkdownTool,
    writeReview: writeReviewTool,
    queryVault: queryVaultTool,
    proposeEdit: proposeEditTool,
    ingestVault: ingestVaultTool,
    moveVaultFile: moveVaultFileTool,
  },
});
