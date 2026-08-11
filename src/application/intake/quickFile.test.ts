import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { quickFileInbox } from "./quickFile.js";
import { clearImageDescriber, setImageDescriber } from "../ports/imageDescriber.js";
import { loadIntakePlan, recordIntakeDecision } from "../../vault/intakePlanStore.js";
import { nowIso } from "../../utils/time.js";

const dirs: string[] = [];
afterEach(async () => {
  clearImageDescriber();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A vault with the given names sitting in `_inbox`. */
async function vaultWithInbox(names: string[]): Promise<string> {
  const vault = await scratch("quickfile-vault-");
  await mkdir(path.join(vault, "_inbox"), { recursive: true });
  for (const name of names) await writeFile(path.join(vault, "_inbox", name), "x", "utf8");
  return vault;
}

describe("quickFileInbox", () => {
  it("files the type-determined entries and leaves the rest to the organizer", async () => {
    const vault = await vaultWithInbox([
      "Screenshot 2026-08-01 at 10.00.00.png",
      "IMG_4821.jpeg",
      "1984.epub",
      "读书笔记.md", // needs judgement
      "账单.pdf", // needs judgement
    ]);
    const home = await scratch("quickfile-home-");

    const report = await quickFileInbox(vault, home);

    expect(report.filed).toBe(3);
    expect(report.remaining).toBe(2);

    const plan = await loadIntakePlan(home);
    const bySource = Object.fromEntries(plan.decisions.map((d) => [d.source, d]));
    expect(bySource["_inbox/Screenshot 2026-08-01 at 10.00.00.png"]).toMatchObject({
      action: "move",
      dest: "media/screenshots",
      decidedBy: "rule",
    });
    expect(bySource["_inbox/IMG_4821.jpeg"]?.dest).toBe("media/photos");
    expect(bySource["_inbox/1984.epub"]?.dest).toBe("resources/books");
    // The two that need reading were not decided at all.
    expect(plan.decisions).toHaveLength(3);
  });

  it("costs no model call when the rules cover everything", async () => {
    const vault = await vaultWithInbox(["Screenshot 2026-08-01 at 1.png", "clip.mp4"]);
    const home = await scratch("quickfile-home-");

    const report = await quickFileInbox(vault, home);

    // `remaining === 0` is what lets runAutoIntake skip the organizer entirely.
    expect(report.filed).toBe(2);
    expect(report.remaining).toBe(0);
  });

  it("never overwrites a decision the organizer already made", async () => {
    const vault = await vaultWithInbox(["IMG_4821.jpeg"]);
    const home = await scratch("quickfile-home-");
    await recordIntakeDecision(
      {
        source: "_inbox/IMG_4821.jpeg",
        kind: "image",
        action: "move",
        dest: "projects/2026-毕设",
        tags: [],
        confidence: 0.9,
        rationale: "毕设答辩现场照片",
        decidedBy: "agent",
        decidedAt: nowIso(),
      },
      home,
    );

    const report = await quickFileInbox(vault, home);

    expect(report.filed).toBe(0);
    const plan = await loadIntakePlan(home);
    // The better-informed decision survives; the rule does not clobber it.
    expect(plan.decisions[0]).toMatchObject({ dest: "projects/2026-毕设", decidedBy: "agent" });
  });

  it("is idempotent across passes", async () => {
    const vault = await vaultWithInbox(["Screenshot 2026-08-01 at 1.png"]);
    const home = await scratch("quickfile-home-");

    await quickFileInbox(vault, home);
    const second = await quickFileInbox(vault, home);

    expect(second.filed).toBe(0);
    expect((await loadIntakePlan(home)).decisions).toHaveLength(1);
  });

  it("ignores OS junk, which the survey already excludes", async () => {
    const vault = await vaultWithInbox([".DS_Store", "Screenshot 2026-08-01 at 1.png"]);
    const home = await scratch("quickfile-home-");

    const report = await quickFileInbox(vault, home);

    expect(report.filed).toBe(1);
    expect(report.remaining).toBe(0);
  });
});

describe("quickFileInbox — escalating to a vision model", () => {
  /** An image whose name says nothing: the 0.6-confidence attachments guess. */
  const hashNamed = "41186B4F3C6AAB264ACA8BCB8230CA37.jpg";

  it("settles the guess by rule when nothing can look at the file", async () => {
    const vault = await vaultWithInbox([hashNamed]);
    const home = await scratch("quickfile-home-");

    const report = await quickFileInbox(vault, home);

    // No vision model: filing it at low confidence still beats leaving it to rot.
    expect(report).toMatchObject({ filed: 1, escalated: 0, remaining: 0 });
    expect((await loadIntakePlan(home)).decisions[0]).toMatchObject({
      dest: "media/attachments",
      decidedBy: "rule",
    });
  });

  it("hands the guess to the organizer when a describer is available", async () => {
    const vault = await vaultWithInbox([hashNamed]);
    const home = await scratch("quickfile-home-");
    setImageDescriber({ available: () => true, describe: async () => { throw new Error("unused"); } });

    const report = await quickFileInbox(vault, home);

    // Reading it beats guessing, and only the organizer can act on what it says.
    expect(report).toMatchObject({ filed: 0, escalated: 1, remaining: 1 });
    expect((await loadIntakePlan(home)).decisions).toHaveLength(0);
  });

  it("still rule-files a confidently named image even with a describer", async () => {
    const vault = await vaultWithInbox(["Screenshot 2026-08-01 at 1.png", "IMG_4821.jpeg"]);
    const home = await scratch("quickfile-home-");
    setImageDescriber({ available: () => true, describe: async () => { throw new Error("unused"); } });

    const report = await quickFileInbox(vault, home);

    // A screenshot belongs in media/screenshots/ whatever it depicts — paying a
    // vision call to confirm that would buy nothing.
    expect(report).toMatchObject({ filed: 2, escalated: 0 });
  });

  it("never escalates a video — nothing here can watch one", async () => {
    const vault = await vaultWithInbox(["面试录像.mp4"]);
    const home = await scratch("quickfile-home-");
    setImageDescriber({ available: () => true, describe: async () => { throw new Error("unused"); } });

    const report = await quickFileInbox(vault, home);

    expect(report).toMatchObject({ filed: 1, escalated: 0 });
  });
});
