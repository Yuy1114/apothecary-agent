import { describe, expect, it } from "vitest";
import { classifyLayer } from "./classifyLayer.js";

describe("classifyLayer", () => {
  it("maps the vault skeleton's top-level directories to their layer", () => {
    expect(classifyLayer("_inbox/房租合同.pdf")).toBe("inbox");
    expect(classifyLayer("journal/2026/2026-07-04.md")).toBe("journal");
    expect(classifyLayer("notes/复利的三个前提.md")).toBe("notes");
    expect(classifyLayer("projects/2026-apothecary/README.md")).toBe("projects");
    expect(classifyLayer("areas/health/sleep.md")).toBe("areas");
    expect(classifyLayer("resources/clippings/x.md")).toBe("resources");
    expect(classifyLayer("records/contracts/2026-07-04-lease.pdf")).toBe("records");
    expect(classifyLayer("media/screenshots/a.png")).toBe("media");
    expect(classifyLayer("archive/notes/old.md")).toBe("archive");
  });

  it("treats the agent's own home (legacy and current) as the agent layer", () => {
    expect(classifyLayer(".apothecary/config.yaml")).toBe("agent");
    expect(classifyLayer(".agent/structure.yaml")).toBe("agent");
  });

  it("falls back to unknown for unrecognized or empty paths", () => {
    expect(classifyLayer("something-else/x.md")).toBe("unknown");
    expect(classifyLayer("")).toBe("unknown");
  });
});
