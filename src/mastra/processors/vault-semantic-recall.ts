import type { ProcessInputArgs, ProcessInputResult, Processor } from "@mastra/core/processors";
import { queryVault } from "../tools/rag.js";

type VaultSemanticRecallOptions = {
  topK?: number;
};

const DEFAULT_TOP_K = 5;

export class VaultSemanticRecallProcessor implements Processor<"vault-semantic-recall"> {
  readonly id = "vault-semantic-recall" as const;
  readonly name = "Vault Semantic Recall";
  readonly description = "Automatically injects semantically relevant vault chunks before the reviewer calls the model.";

  private readonly topK: number;

  constructor(options: VaultSemanticRecallOptions = {}) {
    this.topK = options.topK ?? DEFAULT_TOP_K;
  }

  async processInput({ messageList, messages }: ProcessInputArgs): Promise<ProcessInputResult> {
    const query = messageList.getLatestUserContent()?.trim();
    if (!query) return messages;

    const results = await queryVault(query, this.topK);
    if (results.length === 0) return messages;

    messageList.addSystem(formatRecallContext(results), this.id);
    return messageList;
  }
}

type VaultRecallResult = Awaited<ReturnType<typeof queryVault>>[number];

function formatRecallContext(results: VaultRecallResult[]): string {
  const sections = results.map((result, index) => {
    const headingPath = result.headings && result.headings.length > 0 ? ` > ${result.headings.join(" > ")}` : "";
    const title = result.title ? ` — ${result.title}` : "";
    return [
      `## Source ${index + 1}: ${result.source}${title}${headingPath}`,
      result.content.trim(),
    ].join("\n");
  });

  return [
    "<vault-semantic-recall>",
    "The following vault excerpts were automatically retrieved for the user's latest question.",
    "Use them as supporting context, and cite the source file paths when relying on them.",
    "If the excerpts are insufficient, call queryVault or readMarkdown for deeper inspection instead of guessing.",
    "",
    ...sections,
    "</vault-semantic-recall>",
  ].join("\n");
}
