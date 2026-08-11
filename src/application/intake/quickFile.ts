import { surveyInbox } from "../../vault/inboxSurvey.js";
import { loadIntakePlan, recordIntakeDecision } from "../../vault/intakePlanStore.js";
import { quickFileEntry } from "../../domain/quickFiling.js";
import { imageDescriber } from "../ports/imageDescriber.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";
import { nowIso } from "../../utils/time.js";

/**
 * Run 快速归位 over `_inbox`: every entry whose destination follows from its type
 * gets a decision recorded straight into the intake plan, without an LLM call.
 *
 * Runs *before* the organizer so it only ever sees what genuinely needs
 * judgement — and when nothing is left, the organizer does not run at all. A
 * drop of ten screenshots then costs zero model calls and produces a proposal
 * immediately.
 *
 * Existing decisions are never overwritten: a human may have already reviewed
 * a pending plan, and an agent decision is better-informed than a rule.
 */

export type QuickFileReport = {
  /** Entries the rules placed on this pass. */
  filed: number;
  /** Entries with no rule and no decision yet — what the organizer must handle. */
  remaining: number;
  /** Provisional placements handed to the organizer because a describer can do better. */
  escalated: number;
  /** Vault-relative sources the rules placed, for the log. */
  sources: string[];
};

export async function quickFileInbox(
  vaultPath: string,
  home: string = apothecaryHome(),
  options: { escalate?: boolean } = {},
): Promise<QuickFileReport> {
  const survey = await surveyInbox(vaultPath);
  const decided = new Set((await loadIntakePlan(home)).decisions.map((d) => d.source));
  // A hash-named image is handed over only when something can actually look at
  // it — and only on the first pass. The floor pass (escalate: false) runs after
  // the organizer and applies the rule to whatever it left undecided, so a
  // vision model that is configured but broken cannot leave a file worse off
  // than having no vision model at all.
  const canSee = options.escalate !== false && imageDescriber().available();

  const sources: string[] = [];
  let remaining = 0;
  let escalated = 0;

  for (const entry of survey.entries) {
    if (decided.has(entry.path)) continue;

    const filing = quickFileEntry(entry);
    if (!filing) {
      remaining += 1;
      continue;
    }
    if (filing.provisional && canSee) {
      // Leave it for the organizer, which will read it through the vision model
      // and can both place and rename it properly.
      escalated += 1;
      remaining += 1;
      continue;
    }

    await recordIntakeDecision(
      {
        source: entry.path,
        kind: entry.kind,
        action: "move",
        dest: filing.dest,
        tags: [],
        confidence: filing.confidence,
        rationale: filing.rationale,
        decidedBy: "rule",
        decidedAt: nowIso(),
      },
      home,
    );
    sources.push(entry.path);
  }

  return { filed: sources.length, remaining, escalated, sources };
}
