import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { surveyInbox } from "../../vault/inboxSurvey.js";
import { InboxSurveySchema } from "../../domain/inboxSurvey.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const surveyInboxTool = createTool({
  id: "surveyInbox",
  description:
    "Cheap, read-only overview of _inbox for triage. Returns one entry per top-level item with a coarse kind " +
    "(markdown/pdf/text/image/video/audio/directory/package/junk/other); directories are folded to a file count, " +
    "dominant extensions, and a small name sample instead of every child. Does NOT read file contents. " +
    "Use this FIRST to plan where things go from structure and names alone; only reach for readInboxFile on the " +
    "few entries whose placement is genuinely unclear from the name. Junk (e.g. .DS_Store) is counted and sampled, " +
    "not listed individually — dispose of it by rule.",
  inputSchema: z.object({}),
  outputSchema: InboxSurveySchema,
  execute: async () => surveyInbox(VAULT_PATH),
});
