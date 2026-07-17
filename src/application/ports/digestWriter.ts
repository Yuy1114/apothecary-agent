/**
 * Turns one period's ledger facts into the digest's `## 摘要` narrative. Passed
 * in by the caller (scheduler / desktop composition root), same as NotePolisher
 * — no registry warranted. Implementations must treat the facts as the entire
 * truth: the narrative may compress but never invent.
 */
export interface DigestWriter {
  summarize(input: {
    /** Human period name, e.g. "2026-07-17 日记" scope: "2026-07-17" / "2026-W29". */
    periodTitle: string;
    /** The rendered `## 明细` body — the only facts the narrative may use. */
    factsMarkdown: string;
  }): Promise<string>;
}
