import { Agent } from "@mastra/core/agent";

// Minimal, tool-less agent that synthesizes the standing knowledge-profile
// narrative from vault stats + file gists. Agent-internal context → English.
export const profileWriter = new Agent({
  id: "profile-writer",
  name: "Knowledge Profile Writer",
  description: "Synthesizes a standing knowledge-profile narrative for the whole vault.",
  instructions:
    "You are given whole-vault statistics (top topics/concepts, per-directory file counts, duplicate counts) and a sample " +
    "of per-file gists. Produce a concise standing knowledge profile: an overview of the current knowledge picture, the " +
    "active projects, the areas backed by strong evidence (e.g. interview/career/project material), the weak or thin areas, " +
    "and a few concrete recommendations. Be faithful to the data; do not invent topics or files. " +
    "This profile is agent-internal high-level context, so write it in ENGLISH.",
  model: "deepseek/deepseek-v4-flash",
});
