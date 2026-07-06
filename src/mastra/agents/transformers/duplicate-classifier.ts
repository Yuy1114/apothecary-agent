import { Agent } from "@mastra/core/agent";

// Minimal, tool-less agent that classifies a candidate pair of overlapping
// notes. No tools/processors/memory. Internal semantic-layer reasoning → English.
export const duplicateClassifier = new Agent({
  id: "duplicate-classifier",
  name: "Duplicate Classifier",
  description: "Classifies a candidate pair of overlapping vault notes.",
  instructions:
    "You are given two vault notes that share concepts. Decide their relationship:\n" +
    "- harmful_duplicate: essentially the same content duplicated with no added context value.\n" +
    "- contextual_repetition: the same concept used in genuinely different contexts (different project/course/career), both worth keeping.\n" +
    "- evolutionary_duplicate: an older take and a newer take of the same idea forming a thought evolution.\n" +
    "- not_duplicate: they merely share a topic/concept but are otherwise distinct; no action needed.\n" +
    "Return the classification, a concrete recommendedAction (e.g. merge into a canonical note and archive the copy; " +
    "create/update a canonical note and keep both with references; keep both and mark the older one superseded; or none), " +
    "and a short rationale. Be conservative — only call it harmful_duplicate when the overlap is truly redundant. " +
    "Always write recommendedAction and rationale in ENGLISH, even when the notes are in Chinese, so the semantic layer stays one consistent language.",
  model: "deepseek/deepseek-v4-flash",
});
