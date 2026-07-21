import { describe, expect, it } from "vitest";
import {
  auditReadme,
  parseReadmeEntries,
  reconcileReadme,
  type ActualNote,
} from "./readmeAudit.js";

const README = `# notes

## 笔记索引

- [Redis 笔记](redis.md) — 2026-07-01
- [已删除的旧笔记](old.md) — 2026-06-01
`;

describe("parseReadmeEntries", () => {
  it("extracts local basename links only", () => {
    const entries = parseReadmeEntries(
      `${README}- [外链](https://example.com) — x\n- [子目录](sub/child.md) — y\n`,
    );
    expect(entries).toEqual([
      { title: "Redis 笔记", fileName: "redis.md" },
      { title: "已删除的旧笔记", fileName: "old.md" },
    ]);
  });

  it("returns nothing for a README with no index lines", () => {
    expect(parseReadmeEntries("# notes\n\n只是一些说明文字，没有索引。")).toEqual([]);
  });
});

const note = (fileName: string, title: string): ActualNote => ({ fileName, title, date: "2026-07-21" });

describe("auditReadme", () => {
  const entries = parseReadmeEntries(README);

  it("flags a listed-but-absent file as stale", () => {
    const issues = auditReadme({ entries, actual: [note("redis.md", "Redis 笔记")] });
    expect(issues).toEqual([{ kind: "stale", fileName: "old.md", readmeTitle: "已删除的旧笔记" }]);
  });

  it("flags a present-but-unlisted file as missing", () => {
    const issues = auditReadme({
      entries,
      actual: [note("redis.md", "Redis 笔记"), note("old.md", "已删除的旧笔记"), note("kafka.md", "Kafka")],
    });
    expect(issues).toEqual([{ kind: "missing", fileName: "kafka.md", actualTitle: "Kafka" }]);
  });

  it("flags a drifted title as title_mismatch", () => {
    const issues = auditReadme({
      entries,
      actual: [note("redis.md", "Redis 深入笔记"), note("old.md", "已删除的旧笔记")],
    });
    expect(issues).toEqual([
      { kind: "title_mismatch", fileName: "redis.md", readmeTitle: "Redis 笔记", actualTitle: "Redis 深入笔记" },
    ]);
  });

  it("is clean when the index matches disk exactly", () => {
    expect(
      auditReadme({ entries, actual: [note("redis.md", "Redis 笔记"), note("old.md", "已删除的旧笔记")] }),
    ).toEqual([]);
  });
});

describe("reconcileReadme", () => {
  it("drops stale lines, keeping human prose and valid entries", () => {
    const actual = [note("redis.md", "Redis 笔记")];
    const issues = auditReadme({ entries: parseReadmeEntries(README), actual });
    const fixed = reconcileReadme({ content: README, issues, actual, label: "notes" });
    expect(fixed).toContain("](redis.md)");
    expect(fixed).not.toContain("](old.md)");
    expect(fixed).toContain("# notes");
  });

  it("adds a missing note to the index", () => {
    const actual = [note("redis.md", "Redis 笔记"), note("old.md", "已删除的旧笔记"), note("kafka.md", "Kafka")];
    const issues = auditReadme({ entries: parseReadmeEntries(README), actual });
    const fixed = reconcileReadme({ content: README, issues, actual, label: "notes" });
    expect(fixed).toContain("- [Kafka](kafka.md) — 2026-07-21");
  });

  it("scaffolds a fresh index when there is no README yet", () => {
    const actual = [note("kafka.md", "Kafka")];
    const issues = auditReadme({ entries: [], actual });
    const fixed = reconcileReadme({ content: null, issues, actual, label: "notes" });
    expect(fixed).toContain("# notes");
    expect(fixed).toContain("- [Kafka](kafka.md)");
  });
});
