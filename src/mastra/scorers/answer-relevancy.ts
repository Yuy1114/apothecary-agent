import type { MastraScorers } from "@mastra/core/evals";
import { createAnswerRelevancyScorer } from "@mastra/evals/scorers/prebuilt";

const EVAL_MODEL = "deepseek/deepseek-v4-flash";

export const answerRelevancyScorer = createAnswerRelevancyScorer({
  model: EVAL_MODEL,
});

export const agentRuntimeScorers = {
  answerRelevancy: {
    scorer: answerRelevancyScorer,
    sampling: { type: "ratio", rate: 1 },
  },
} satisfies MastraScorers;
