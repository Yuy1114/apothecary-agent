import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { auditReadmeConsistency } from "./auditReadmes.js";

let vault: string;

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(vault, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

beforeEach(async () => {
  vault = await fs.mkdtemp(path.join(os.tmpdir(), "readme-audit-"));
});
afterEach(async () => {
  await fs.rm(vault, { recursive: true, force: true });
});

describe("auditReadmeConsistency", () => {
  it("reports stale and missing entries for a filed directory", async () => {
    await write("notes/README.md", "# notes\n\n## 笔记索引\n\n- [Redis](redis.md) — 2026-07-01\n- [旧](old.md) — 2026-06-01\n");
    await write("notes/redis.md", "# Redis\n内容");
    await write("notes/kafka.md", "# Kafka\n内容");

    const audits = await auditReadmeConsistency(vault);
    expect(audits).toHaveLength(1);
    expect(audits[0].dir).toBe("notes");
    expect(audits[0].issues.map((i) => `${i.kind}:${i.fileName}`).sort()).toEqual([
      "missing:kafka.md",
      "stale:old.md",
    ]);
    expect(audits[0].reconciledContent).toContain("](kafka.md)");
    expect(audits[0].reconciledContent).not.toContain("](old.md)");
  });

  it("leaves _inbox, archive, and the vault root out of scope", async () => {
    await write("_inbox/README.md", "## 笔记索引\n\n- [ghost](ghost.md) — x\n");
    await write("archive/README.md", "## 笔记索引\n\n- [ghost](ghost.md) — x\n");
    await write("README.md", "## 笔记索引\n\n- [ghost](ghost.md) — x\n");

    expect(await auditReadmeConsistency(vault)).toEqual([]);
  });

  it("is clean when every filed README matches disk", async () => {
    await write("notes/README.md", "## 笔记索引\n\n- [Redis](redis.md) — 2026-07-01\n");
    await write("notes/redis.md", "# Redis\n内容");

    expect(await auditReadmeConsistency(vault)).toEqual([]);
  });
});
