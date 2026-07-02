import { runEvals } from "@mastra/core/evals";
import { describe, expect, it } from "vitest";
import { answerRelevancyScorer } from "../scorers/answer-relevancy.js";
import { vaultReviewer } from "./vault-reviewer.js";

const hasModelKey = Boolean(process.env.DEEPSEEK_API_KEY);

const describeWithModel = hasModelKey ? describe : describe.skip;

describeWithModel("vaultReviewer evals", () => {
  it("answers identity/responsibility questions with relevant responses", async () => {
    const result = await runEvals({
      target: vaultReviewer,
      data: [
        {
          input: "用一句话说明你在这个项目里负责什么。",
        },
      ],
      scorers: [{ scorer: answerRelevancyScorer, threshold: 0.5 }],
      targetOptions: { maxSteps: 1 },
      concurrency: 1,
    });

    expect(result.summary.totalItems).toBe(1);
    expect(result.scores[answerRelevancyScorer.id]).toBeGreaterThanOrEqual(0.5);
  });
});
