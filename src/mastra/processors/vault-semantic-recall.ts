import type { ProcessInputArgs, ProcessInputResult, Processor } from "@mastra/core/processors";
import { queryVault } from "../tools/rag.js";
import { loadSummaries } from "../../vault/semanticStore.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";
import type { FileSummaries } from "../../domain/semantic.js";

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

    // Expand each retrieved excerpt with its file's semantic summary so the
    // model sees what the whole source is about, not just the matched chunk.
    const summaries = await loadSummaries(apothecaryHome());

    messageList.addSystem(formatRecallContext(results, summaries), this.id);
    return messageList;
  }
}

type VaultRecallResult = Awaited<ReturnType<typeof queryVault>>[number];

function formatRecallContext(results: VaultRecallResult[], summaries: FileSummaries): string {
  const sections = results.map((result, index) => {
    const headingPath = result.headings && result.headings.length > 0 ? ` > ${result.headings.join(" > ")}` : "";
    const title = result.title ? ` — ${result.title}` : "";
    const summary = summaries[result.source];
    const summaryLine = summary
      ? `File summary: ${summary.gist}` +
        (summary.topics.length > 0 ? ` (topics: ${summary.topics.join(", ")})` : "")
      : "";
    const supersededLine = result.supersededBy
      ? `⚠ Superseded by ${result.supersededBy} — prefer the canonical note; treat this as historical context.`
      : "";
    return [
      `## Source ${index + 1}: ${result.source}${title}${headingPath}`,
      supersededLine,
      summaryLine,
      result.content.trim(),
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    "<vault-semantic-recall>",
    "The following vault excerpts were automatically retrieved for the user's latest question.",
    "Each source may include a file-level summary (gist + topics) followed by the matched excerpt.",
    "Use them as supporting context. You MUST end your reply with a new line `来源：` that lists the",
    "exact Source file paths you actually relied on (copy the paths verbatim from below; never invent one).",
    "If none of these excerpts are relevant, say so plainly and call queryVault or readMarkdown instead of guessing.",
    "",
    ...sections,
    "</vault-semantic-recall>",
  ].join("\n");
}
