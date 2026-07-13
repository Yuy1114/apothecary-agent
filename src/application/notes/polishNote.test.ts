import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setSearchIndex, nullSearchIndex, type SearchHit } from "../ports/searchIndex.js";
import type { NotePolisher } from "../ports/notePolisher.js";
import type { NotePolishDraft } from "../../domain/notePolish.js";
import { listProposals } from "../../vault/proposalStore.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";
import { polishNote } from "./polishNote.js";

let vault: string;
let home: string;
const roots: string[] = [];

// Fresh vault + agent home per test so proposal listings never bleed across cases.
beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "apothecary-polish-vault-"));
  home = await mkdtemp(path.join(tmpdir(), "apothecary-polish-home-"));
  roots.push(vault, home);
  vi.stubEnv("APOTHECARY_HOME", home);
  setSearchIndex(nullSearchIndex);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const NOTE = `---
title: Redis 笔记
created: 2026-01-02
tags:
  - redis
---
# Redis

原始内容，写得比较随意。
`;

async function writeNote(rel: string, content: string = NOTE): Promise<void> {
  await mkdir(path.dirname(path.join(vault, rel)), { recursive: true });
  await writeFile(path.join(vault, rel), content, "utf8");
}

function fakePolisher(draft: Partial<NotePolishDraft> = {}): {
  polisher: NotePolisher;
  calls: Parameters<NotePolisher["polish"]>[0][];
} {
  const calls: Parameters<NotePolisher["polish"]>[0][] = [];
  return {
    calls,
    polisher: {
      async polish(input) {
        calls.push(input);
        return {
          body: "# Redis\n\n润色后的内容，结构更清晰、重点已突出。",
          addTags: [],
          changeSummary: "重排了标题结构",
          ...draft,
        };
      },
    },
  };
}

describe("polishNote", () => {
  it("records an edit proposal with the frontmatter block preserved verbatim", async () => {
    await writeNote("notes/redis.md");
    const { polisher, calls } = fakePolisher();

    const result = await polishNote(
      { vaultPath: vault, filePath: "notes/redis.md", modes: ["format"] },
      polisher,
    );

    // The polisher saw the body only, plus the parsed tags.
    expect(calls[0].noteBody).not.toContain("title: Redis 笔记");
    expect(calls[0].existingTags).toEqual(["redis"]);
    expect(calls[0].relatedExcerpts).toEqual([]);

    const proposals = await listProposals(apothecaryHome());
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];
    expect(proposal.id).toBe(result.proposalId);
    expect(proposal.type).toBe("edit");
    expect(proposal.status).toBe("proposed");
    if (proposal.type !== "edit") throw new Error("unreachable");
    expect(proposal.payload.filePath).toBe("notes/redis.md");
    // Frontmatter untouched byte-for-byte; body replaced.
    expect(proposal.payload.suggestedContent.startsWith("---\ntitle: Redis 笔记\ncreated: 2026-01-02\ntags:\n  - redis\n---\n")).toBe(true);
    expect(proposal.payload.suggestedContent).toContain("润色后的内容");
    expect(proposal.payload.suggestedContent).not.toContain("原始内容");
  });

  it("merges suggested tags into frontmatter, deduped against existing ones", async () => {
    await writeNote("notes/redis.md");
    const { polisher } = fakePolisher({ addTags: ["redis", "缓存"] });

    await polishNote(
      { vaultPath: vault, filePath: "notes/redis.md", modes: ["format", "tags"] },
      polisher,
    );

    const [proposal] = await listProposals(apothecaryHome());
    if (proposal.type !== "edit") throw new Error("unreachable");
    const tagLines = proposal.payload.suggestedContent
      .split("\n")
      .filter((line) => line.startsWith("  - "));
    expect(tagLines).toEqual(["  - redis", "  - 缓存"]);
    // Untouched keys stay byte-identical even when tags are inserted (the
    // gray-matter round-trip would rewrite the date as an ISO timestamp).
    expect(proposal.payload.suggestedContent).toContain("created: 2026-01-02\n");
  });

  it("feeds filtered related excerpts to the polisher in expand mode", async () => {
    await writeNote("notes/redis.md");
    const hits: SearchHit[] = [
      { source: "notes/redis.md", content: "self hit" },
      { source: "notes/old.md", content: "superseded", supersededBy: "notes/new.md" },
      { source: "notes/cache.md", content: "缓存策略笔记内容" },
    ];
    setSearchIndex({ ...nullSearchIndex, queryVault: async () => hits });
    const { polisher, calls } = fakePolisher();

    await polishNote(
      { vaultPath: vault, filePath: "notes/redis.md", modes: ["expand"] },
      polisher,
    );

    expect(calls[0].relatedExcerpts).toEqual([
      { path: "notes/cache.md", excerpt: "缓存策略笔记内容" },
    ]);
  });

  it("degrades to a context-free polish when retrieval fails", async () => {
    await writeNote("notes/redis.md");
    setSearchIndex({
      ...nullSearchIndex,
      queryVault: async () => {
        throw new Error("embedding endpoint down");
      },
    });
    const { polisher, calls } = fakePolisher();

    await polishNote(
      { vaultPath: vault, filePath: "notes/redis.md", modes: ["expand"] },
      polisher,
    );

    expect(calls[0].relatedExcerpts).toEqual([]);
    expect(await listProposals(apothecaryHome())).toHaveLength(1);
  });

  it("rejects non-markdown, escaping, and agent-internal paths", async () => {
    const { polisher } = fakePolisher();
    await expect(
      polishNote({ vaultPath: vault, filePath: "notes/a.txt", modes: ["format"] }, polisher),
    ).rejects.toThrow("unsupported_text_type");
    await expect(
      polishNote({ vaultPath: vault, filePath: "../outside.md", modes: ["format"] }, polisher),
    ).rejects.toThrow("unsafe_path");
    await expect(
      polishNote({ vaultPath: vault, filePath: ".agent/views/x.md", modes: ["format"] }, polisher),
    ).rejects.toThrow("agent_internal_path");
    expect(await listProposals(apothecaryHome())).toHaveLength(0);
  });

  it("does not create a proposal when the draft fails validation", async () => {
    await writeNote("notes/redis.md");
    const { polisher } = fakePolisher({ body: "太短" });

    await expect(
      polishNote({ vaultPath: vault, filePath: "notes/redis.md", modes: ["format"] }, polisher),
    ).rejects.toThrow("polish_rejected:body_shrunk");
    expect(await listProposals(apothecaryHome())).toHaveLength(0);
  });
});
