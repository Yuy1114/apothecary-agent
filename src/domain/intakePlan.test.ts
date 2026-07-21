import { describe, expect, it } from "vitest";
import { buildIntakeDecisionViews, type IntakeDecision } from "./intakePlan.js";

function decision(over: Partial<IntakeDecision>): IntakeDecision {
  return {
    source: "_inbox/a.md",
    kind: "markdown",
    action: "move",
    tags: [],
    confidence: 0.9,
    rationale: "reason",
    decidedAt: "2026-07-21T00:00:00.000Z",
    ...over,
  };
}

describe("buildIntakeDecisionViews", () => {
  it("maps a file move to source → computed target", () => {
    const [view] = buildIntakeDecisionViews([
      decision({ source: "_inbox/PPT.pdf", kind: "pdf", dest: "resources/" }),
    ]);
    expect(view).toMatchObject({ action: "move", source: "_inbox/PPT.pdf", target: "resources/PPT.pdf" });
  });

  it("honours a rename in the move target", () => {
    const [view] = buildIntakeDecisionViews([
      decision({ source: "_inbox/a.md", dest: "notes/", rename: "b.md" }),
    ]);
    expect(view.target).toBe("notes/b.md");
  });

  it("renders a directory move as `source/* → dest`", () => {
    const [view] = buildIntakeDecisionViews([
      decision({ source: "_inbox/proj", kind: "directory", dest: "areas/proj" }),
    ]);
    expect(view).toMatchObject({ source: "_inbox/proj/*", target: "areas/proj" });
  });

  it("targets the archive for an archive decision", () => {
    const [view] = buildIntakeDecisionViews([decision({ action: "archive" })]);
    expect(view.target).toBe("archive/");
  });

  it("leaves a `leave` decision with no target (stays put)", () => {
    const [view] = buildIntakeDecisionViews([decision({ action: "leave" })]);
    expect(view.target).toBeUndefined();
  });

  it("orders moves first, archives next, kept-in-place last", () => {
    const views = buildIntakeDecisionViews([
      decision({ source: "_inbox/keep.md", action: "leave" }),
      decision({ source: "_inbox/z.md", action: "move", dest: "notes/" }),
      decision({ source: "_inbox/old.md", action: "archive" }),
      decision({ source: "_inbox/a.md", action: "move", dest: "notes/" }),
    ]);
    expect(views.map((v) => v.action)).toEqual(["move", "move", "archive", "leave"]);
    // Ties within an action group break by source path.
    expect(views[0].source).toBe("_inbox/a.md");
    expect(views[1].source).toBe("_inbox/z.md");
  });
});
