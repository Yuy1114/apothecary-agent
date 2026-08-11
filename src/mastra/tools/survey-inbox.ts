import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { surveyInbox } from "../../vault/inboxSurvey.js";
import { loadIntakePlan } from "../../vault/intakePlanStore.js";
import { InboxSurveySchema } from "../../domain/inboxSurvey.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";

const VAULT_PATH = process.env.APOTHECARY_VAULT_PATH ?? "/Users/yuy/apothecary-vault";

export const surveyInboxTool = createTool({
  id: "surveyInbox",
  description:
    "Cheap, read-only overview of _inbox for triage. Returns one entry per top-level item with a coarse kind " +
    "(markdown/pdf/text/image/video/audio/directory/package/junk/other); directories are folded to a file count, " +
    "dominant extensions, and a small name sample instead of every child. Does NOT read file contents. " +
    "Use this FIRST to plan where things go from structure and names alone; only reach for readInboxFile on the " +
    "few entries whose placement is genuinely unclear from the name. Junk (e.g. .DS_Store) is counted and sampled, " +
    "not listed individually — dispose of it by rule. Entries already placed by a deterministic 快速归位 rule " +
    "(screenshots, photos, media, books, source files) are omitted: they are settled, and nothing you could add " +
    "would change where they go.",
  inputSchema: z.object({}),
  outputSchema: InboxSurveySchema,
  execute: async () => {
    const survey = await surveyInbox(VAULT_PATH);
    // Rule decisions are deterministic and already recorded; showing them again
    // only invites the organizer to spend a decision reproducing them. Agent
    // decisions stay visible, so a rejected plan can still be revised.
    const settled = new Set(
      (await loadIntakePlan(apothecaryHome())).decisions
        .filter((decision) => decision.decidedBy === "rule")
        .map((decision) => decision.source),
    );
    if (settled.size === 0) return survey;
    return { ...survey, entries: survey.entries.filter((entry) => !settled.has(entry.path)) };
  },
});
