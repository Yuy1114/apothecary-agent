/** One popover-local Q&A exchange carried into a follow-up quick ask. */
export type QuickAskTurn = { question: string; answer: string };

/**
 * Builds the single prompt string for a quick-ask (划词快问) call. The prompt is
 * the agent's entire view of the world: no conversation history, only the
 * selection, its bounded surrounding context, and at most the last two turns
 * from the same popover.
 */
export function buildQuickAskPrompt(input: {
  question: string;
  selection: string;
  contextText: string;
  sourceLabel: string;
  priorTurns: QuickAskTurn[];
}): string {
  const parts = [
    `Source: ${input.sourceLabel}`,
    `Context:\n"""\n${input.contextText}\n"""`,
    `Selected text:\n"""\n${input.selection}\n"""`,
  ];
  const turns = input.priorTurns.slice(-2);
  if (turns.length > 0) {
    const rendered = turns.map((turn) => `Q: ${turn.question}\nA: ${turn.answer}`).join("\n\n");
    parts.push(`Earlier turns in this popover:\n${rendered}`);
  }
  parts.push(`Question: ${input.question}`);
  return parts.join("\n\n");
}
