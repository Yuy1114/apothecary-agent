/** One popover-local Q&A exchange carried into a follow-up quick ask. */
export type QuickAskTurn = { question: string; answer: string };

/** One retrieved note excerpt grounding a direct (selection-less) quick ask. */
export type QuickAskExcerpt = { path: string; excerpt: string };

/**
 * Builds the single prompt string for a quick-ask (划词快问) call. The prompt is
 * the agent's entire view of the world: no conversation history, only the
 * selection (when any), its bounded surrounding context, vault-search excerpts
 * for a direct ask, and at most the last two turns from the same popover.
 * Empty blocks are omitted entirely rather than sent as empty quotes.
 */
export function buildQuickAskPrompt(input: {
  question: string;
  selection: string;
  contextText: string;
  sourceLabel: string;
  priorTurns: QuickAskTurn[];
  relatedExcerpts?: QuickAskExcerpt[];
}): string {
  const parts = [`Source: ${input.sourceLabel}`];
  if (input.contextText.trim()) parts.push(`Context:\n"""\n${input.contextText}\n"""`);
  if (input.selection.trim()) parts.push(`Selected text:\n"""\n${input.selection}\n"""`);
  const excerpts = input.relatedExcerpts ?? [];
  if (excerpts.length > 0) {
    const rendered = excerpts.map((e) => `- ${e.path}:\n"""\n${e.excerpt}\n"""`).join("\n");
    parts.push(`Related notes (vault search on the question):\n${rendered}`);
  }
  const turns = input.priorTurns.slice(-2);
  if (turns.length > 0) {
    const rendered = turns.map((turn) => `Q: ${turn.question}\nA: ${turn.answer}`).join("\n\n");
    parts.push(`Earlier turns in this popover:\n${rendered}`);
  }
  parts.push(`Question: ${input.question}`);
  return parts.join("\n\n");
}
