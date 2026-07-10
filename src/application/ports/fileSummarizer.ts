import type { FileSummary } from "../../domain/semantic.js";

/**
 * Turns one note into its semantic summary. Backed by an LLM in production
 * (see mastra/adapters/mastraFileSummarizer.ts); the use cases only need the
 * domain shape back.
 *
 * Registry-injected rather than passed down, because the summarizer is needed
 * deep inside application-internal chains — manualSync, resolveProposal and
 * semanticRecovery all reach syncSemanticsForPaths without any infra caller in
 * between to hand it over. Ports whose callers all live in infra (the knowledge
 * view writer, the reviewer model) are passed explicitly instead.
 */
export type SummarizeFile = (input: {
  path: string;
  title: string;
  content: string;
  contentHash: string;
}) => Promise<FileSummary>;

let installed: SummarizeFile | null = null;

export function setFileSummarizer(next: SummarizeFile): void {
  installed = next;
}

export function fileSummarizer(): SummarizeFile {
  if (!installed) {
    throw new Error(
      "File summarizer not installed. Call setFileSummarizer() at the composition root.",
    );
  }
  return installed;
}
