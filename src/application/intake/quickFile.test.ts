import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { quickFileInbox } from "./quickFile.js";
import { loadIntakePlan, recordIntakeDecision } from "../../vault/intakePlanStore.js";
import { nowIso } from "../../utils/time.js";

const dirs: string[] = [];
afterEach(async () => {
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
