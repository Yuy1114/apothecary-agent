import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { DIGEST_SUMMARY_QUIET, collectDigestFacts, digestExists, generateDigest } from "./activityDigest.js";
import { DIGEST_SUMMARY_FALLBACK, periodKeyFor } from "../../domain/journal.js";
import { enqueueChange, initChangeLog, setChangeLogClient } from "../../vault/changeLog.js";
import { initOperationLedger, recordOperation, setOperationLedgerClient } from "../../vault/operationLedger.js";
import { saveProposal } from "../../vault/proposalStore.js";
import { nullSearchIndex, setSearchIndex } from "../../application/ports/searchIndex.js";
import type { DigestWriter } from "../ports/digestWriter.js";

const dirs: string[] = [];
const today = periodKeyFor("daily");

afterEach(async () => {
  setChangeLogClient(null);
  setOperationLedgerClient(null);
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "apothecary-digest-"));
  dirs.push(root);
  const vaultPath = path.join(root, "vault");
  const home = path.join(root, "home");
  await mkdir(vaultPath, { recursive: true });
  await mkdir(home, { recursive: true });
  vi.stubEnv("APOTHECARY_HOME", home);
  setSearchIndex({ ...nullSearchIndex });
  await initChangeLog(`file:${path.join(root, "change-log.db")}`);
  await initOperationLedger(`file:${path.join(root, "operations.db")}`);
  return { vaultPath, home, root };
}

const echoWriter = (calls: string[] = []): DigestWriter => ({
  summarize: async ({ factsMarkdown }) => {
    calls.push(factsMarkdown);
    return "这一天主要在整理知识库。";
  },
});

describe("collectDigestFacts", () => {
  it("groups both ledgers and resolved proposals, excluding digest self-references", async () => {
    const { home } = await setup();
    await enqueueChange({ path: "notes/JS OOP.md", changeType: "created", source: "watcher" });
    await enqueueChange({ path: `journal/digests/daily/${today}.md`, changeType: "modified", source: "watcher" });
    await recordOperation({ type: "move", targetFiles: ["_inbox/a.md", "notes/a.md"], rationale: "归位", source: "proposal" });
    await recordOperation({ type: "capture", targetFiles: [`journal/digests/daily/${today}.md`], rationale: "生成摘要", source: "digest" });
    const now = new Date().toISOString();
    await saveProposal(home, {
      id: "prop-test-1", type: "move", status: "applied", title: "把 a 移到 notes/",
      rationale: "r", payload: { from: "_inbox/a.md", to: "notes/a.md" },
      targetFiles: ["_inbox/a.md", "notes/a.md"], createdAt: now, resolvedAt: now,
    } as never);
    await saveProposal(home, {
      id: "prop-test-2", type: "edit", status: "proposed", title: "还没审的",
      rationale: "r", payload: { filePath: "notes/a.md", suggestedContent: "x" },
      targetFiles: ["notes/a.md"], createdAt: now,
    } as never);

    const facts = await collectDigestFacts("daily", today);
    expect(facts.userChanges).toEqual([{ kind: "created", path: "notes/JS OOP.md" }]);
    expect(facts.agentOperations).toEqual([
      { type: "move", path: "notes/a.md", fromPath: "_inbox/a.md", detail: "归位" },
    ]);
    expect(facts.proposals).toEqual([{ title: "把 a 移到 notes/", outcome: "applied" }]);
  });

  it("ignores activity outside the period window", async () => {
    const { root } = await setup();
    const db = createClient({ url: `file:${path.join(root, "change-log.db")}` });
    await db.execute({
      sql: `INSERT INTO vault_change_log (id, path, change_type, source, status, detected_at)
            VALUES ('c-old', 'notes/old.md', 'created', 'watcher', 'pending', '2020-01-01T00:00:00.000Z')`,
      args: [],
    });
    db.close();
    const facts = await collectDigestFacts("daily", today);
    expect(facts.userChanges).toEqual([]);
  });
});

describe("generateDigest", () => {
  it("writes the digest with narrative + deterministic facts and records the operation", async () => {
    const { vaultPath } = await setup();
    await enqueueChange({ path: "notes/JS OOP.md", changeType: "created", source: "watcher" });
    const calls: string[] = [];
    const result = await generateDigest({ vaultPath, cadence: "daily", key: today }, echoWriter(calls));

    expect(result.degraded).toBe(false);
    expect(calls[0]).toContain("- 新增 notes/JS OOP.md");
    const onDisk = await readFile(path.join(vaultPath, result.relPath), "utf8");
    expect(onDisk).toContain("type: activity-digest");
    expect(onDisk).toContain("这一天主要在整理知识库。");
    expect(onDisk).toContain("- 新增 notes/JS OOP.md");
    expect(await digestExists(vaultPath, "daily", today)).toBe(true);
  });

  it("degrades to the fallback placeholder when the writer fails — facts still land", async () => {
    const { vaultPath } = await setup();
    await enqueueChange({ path: "notes/x.md", changeType: "modified", source: "watcher" });
    const failing: DigestWriter = { summarize: async () => { throw new Error("llm down"); } };
    const result = await generateDigest({ vaultPath, cadence: "daily", key: today }, failing);

    expect(result.degraded).toBe(true);
    const onDisk = await readFile(path.join(vaultPath, result.relPath), "utf8");
    expect(onDisk).toContain(DIGEST_SUMMARY_FALLBACK);
    expect(onDisk).toContain("- 修改 notes/x.md");
  });

  it("skips the LLM entirely for an empty period", async () => {
    const { vaultPath } = await setup();
    const calls: string[] = [];
    const result = await generateDigest({ vaultPath, cadence: "daily", key: today }, echoWriter(calls));
    expect(calls).toHaveLength(0);
    expect(result.content).toContain(DIGEST_SUMMARY_QUIET);
  });

  it("rejects malformed keys before touching anything", async () => {
    const { vaultPath } = await setup();
    await expect(generateDigest({ vaultPath, cadence: "daily", key: "../evil" }, echoWriter())).rejects.toThrow(
      "invalid_journal_key",
    );
  });
});
