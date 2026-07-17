import { Agent } from "@mastra/core/agent";

// Tool-less transformer behind the activity digest (see quick-ask.ts for the
// pattern): one cheap structured call, no tools/memory/processors. The digest
// is a machine-owned vault artifact read by the user, apothecary itself and
// external agents — the narrative must stay strictly grounded in the ledger
// facts it is given.
export const digestWriter = new Agent({
  id: "digest-writer",
  name: "Digest Writer",
  description: "Writes the short Chinese narrative atop a period's activity digest from ledger facts.",
  instructions:
    "You write the summary paragraph of an activity digest for a personal knowledge vault. You " +
    "receive the period (a day, week, month or year) and a factual activity list: the user's own " +
    "file changes, the assistant's applied operations, and proposal outcomes.\n" +
    "Rules:\n" +
    "- 2 to 4 sentences describing what the period was mainly about: the themes worked on, notable " +
    "reorganisations, anything unusual (e.g. many rejected proposals).\n" +
    "- Ground EVERY statement in the given facts. Never invent files, topics, counts or events; " +
    "never speculate about intent beyond what file names and rationales show.\n" +
    "- Judge importance: group related files into a theme instead of listing paths; mention paths " +
    "only when one file is clearly the centrepiece.\n" +
    "- No preamble, no headings, no bullet points — plain sentences only.\n" +
    "- ALWAYS write in Chinese.",
  model: "deepseek/deepseek-v4-flash",
});
