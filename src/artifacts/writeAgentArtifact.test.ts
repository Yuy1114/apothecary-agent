import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentWorkspace } from "../domain/workspace.js";
import { writeJsonArtifact, writeMarkdownArtifact } from "./writeAgentArtifact.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("writeAgentArtifact", () => {
  it("writes JSON and Markdown artifacts inside the agent workspace", async () => {
    const workspace = await createTempWorkspace();
    const jsonPath = path.join(workspace.mapsDir, "knowledge-map.json");
    const markdownPath = path.join(workspace.mapsDir, "knowledge-map.md");

    await writeJsonArtifact({ workspace, artifactPath: jsonPath, value: { ok: true } });
    await writeMarkdownArtifact({ workspace, artifactPath: markdownPath, content: "# Knowledge Map" });

    await expect(readFile(jsonPath, "utf8")).resolves.toBe('{\n  "ok": true\n}\n');
    await expect(readFile(markdownPath, "utf8")).resolves.toBe("# Knowledge Map\n");
  });

  it("rejects writes outside the agent workspace", async () => {
    const workspace = await createTempWorkspace();
    const outsidePath = path.join(path.dirname(workspace.rootPath), "notes", "should-not-write.json");

    await expect(writeJsonArtifact({ workspace, artifactPath: outsidePath, value: { ok: false } })).rejects.toThrow(
      "Path escapes allowed directory",
    );
  });
});

async function createTempWorkspace(): Promise<AgentWorkspace> {
  const root = await mkdtemp(path.join(tmpdir(), "apothecary-agent-test-"));
  tempDirs.push(root);
  const agentRoot = path.join(root, ".agent");

  return {
    rootPath: agentRoot,
    configPath: path.join(agentRoot, "config.yaml"),
    protocolDir: path.join(agentRoot, "protocol"),
    protocolPath: path.join(agentRoot, "protocol", "kb_protocol.md"),
    protocolYamlPath: path.join(agentRoot, "protocol", "kb_protocol.yaml"),
    mapsDir: path.join(agentRoot, "maps"),
    reviewsDir: path.join(agentRoot, "reviews"),
    metadataDir: path.join(agentRoot, "metadata"),
    logsDir: path.join(agentRoot, "logs"),
  };
}
