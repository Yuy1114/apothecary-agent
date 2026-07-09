import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initOperationLedger, setOperationLedgerClient } from "../../vault/operationLedger.js";
import { recordIntakeDecision, loadIntakePlan } from "../../vault/intakePlanStore.js";
import type { IntakeDecision } from "../../domain/intakePlan.js";

const reindexFile = vi.fn(async () => ({ added: 1 }));
const removeFromIndex = vi.fn(async () => ({ removed: 1 }));
vi.mock("./rag.js", () => ({ reindexFile, removeFromIndex }));

let vault: string;
let executeIntake: typeof import("./execute-intake-core.js").executeIntake;
const abs = (rel: string) => path.join(vault, rel);
const exists = (rel: string) => access(abs(rel)).then(() => true, () => false);

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "apothecary-exec-intake-"));
  await mkdir(abs("_inbox"), { recursive: true });
  await initOperationLedger(`file:${path.join(vault, "operations.db")}`);
  reindexFile.mockClear();
  removeFromIndex.mockClear();
  vi.stubEnv("APOTHECARY_VAULT_PATH", vault);
  vi.stubEnv("APOTHECARY_HOME", vault);
  // The core (and the move/archive cores it uses) read VAULT_PATH at module load,
  // so re-evaluate the graph per test to pick up this test's fresh vault.
  vi.resetModules();
  ({ executeIntake } = await import("./execute-intake-core.js"));
});

afterEach(async () => {
  setOperationLedgerClient(null);
  vi.unstubAllEnvs();
  await rm(vault, { recursive: true, force: true });
});

function decision(o: Partial<IntakeDecision> & Pick<IntakeDecision, "source" | "action">): IntakeDecision {
  return { kind: "markdown", tags: [], confidence: 0.9, rationale: "r", decidedAt: "t", ...o };
}

describe("executeIntake", () => {
  it("moves, archives, and leaves per plan; tags moved markdown; consumes the plan", async () => {
    await writeFile(abs("_inbox/note.md"), "# Note\n\nbody", "utf8");
    await writeFile(abs("_inbox/old.md"), "# Old", "utf8");
    await writeFile(abs("_inbox/keep.md"), "# Keep", "utf8");
    await recordIntakeDecision(
      decision({ source: "_inbox/note.md", action: "move", dest: "notes/", tags: ["programming", "java"] }),
      vault,
    );
    await recordIntakeDecision(decision({ source: "_inbox/old.md", action: "archive" }), vault);
    await recordIntakeDecision(decision({ source: "_inbox/keep.md", action: "leave", confidence: 0.4 }), vault);

    const report = await executeIntake();
    expect(report).toMatchObject({ total: 3, moved: 1, archived: 1, left: 1, failed: 0 });

    // Moved into notes/ with the path tags stamped into frontmatter.
    expect(await exists("notes/note.md")).toBe(true);
    expect(await exists("_inbox/note.md")).toBe(false);
    const moved = await readFile(abs("notes/note.md"), "utf8");
    expect(moved).toMatch(/programming/);
    expect(moved).toMatch(/java/);
    expect(moved).toContain("body");

    // Archived (out of _inbox, under archive/) and left (still in _inbox).
    expect(await exists("_inbox/old.md")).toBe(false);
    expect(await exists("_inbox/keep.md")).toBe(true);

    // Plan consumed.
    expect((await loadIntakePlan(vault)).decisions).toHaveLength(0);

    // `affected` reports the touched paths (so a follow-on semantic refresh can
    // re-summarize the target and prune the vacated source) but not `leave`s.
    expect(new Set(report.affected)).toEqual(new Set(["_inbox/note.md", "notes/note.md", "_inbox/old.md"]));
    expect(report.affected).not.toContain("_inbox/keep.md");
  });

  it("merges a directory's contents INTO dest instead of nesting it", async () => {
    await mkdir(abs("_inbox/books/sub"), { recursive: true });
    await writeFile(abs("_inbox/books/a.epub"), "e", "utf8");
    await writeFile(abs("_inbox/books/sub/b.pdf"), "p", "utf8");
    await mkdir(abs("resources/books"), { recursive: true });
    await writeFile(abs("resources/books/.gitkeep"), "", "utf8"); // dest pre-exists (non-empty)
    await recordIntakeDecision(decision({ source: "_inbox/books", kind: "directory", action: "move", dest: "resources/books/" }), vault);

    const report = await executeIntake();
    expect(report).toMatchObject({ moved: 1, failed: 0 });

    // Contents merged directly under resources/books (NOT resources/books/books).
    expect(await exists("resources/books/a.epub")).toBe(true);
    expect(await exists("resources/books/sub/b.pdf")).toBe(true);
    expect(await exists("resources/books/books")).toBe(false);
    // Source dir emptied and pruned.
    expect(await exists("_inbox/books")).toBe(false);
  });

  it("reports a missing source as a failure without throwing", async () => {
    await recordIntakeDecision(decision({ source: "_inbox/ghost.md", action: "move", dest: "notes/" }), vault);
    const report = await executeIntake();
    expect(report.failed).toBe(1);
    expect(report.failures[0]).toMatchObject({ source: "_inbox/ghost.md", reason: "missing_source" });
  });
});
