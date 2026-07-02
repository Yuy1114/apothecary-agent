import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentArtifacts } from "./agentArtifacts.types.js";
import { appendTextArtifact, writeJsonArtifact, writeMarkdownArtifact, writeTextArtifactIfMissing } from "./writeAgentArtifact.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("writeAgentArtifact", () => {
  it("writes JSON and Markdown artifacts inside the agent workspace", async () => {
    const artifacts = await createTempArtifacts();
    const jsonPath = path.join(artifacts.mapsDir, "knowledge-map.json");
    const markdownPath = path.join(artifacts.mapsDir, "knowledge-map.md");

    await writeJsonArtifact({ artifacts, artifactPath: jsonPath, value: { ok: true } });
    await writeMarkdownArtifact({ artifacts, artifactPath: markdownPath, content: "# Knowledge Map" });

    await expect(readFile(jsonPath, "utf8")).resolves.toBe('{\n  "ok": true\n}\n');
    await expect(readFile(markdownPath, "utf8")).resolves.toBe("# Knowledge Map\n");
  });

  it("rejects writes outside the agent workspace", async () => {
    const artifacts = await createTempArtifacts();
    const outsidePath = path.join(path.dirname(artifacts.rootPath), "notes", "should-not-write.json");

    await expect(writeJsonArtifact({ artifacts, artifactPath: outsidePath, value: { ok: false } })).rejects.toThrow(
      "Path escapes allowed directory",
    );
  });

  it("writes missing text artifacts without overwriting existing content", async () => {
    const artifacts = await createTempArtifacts();
    const configPath = path.join(artifacts.rootPath, "config.yaml");

    await expect(writeTextArtifactIfMissing({ artifacts, artifactPath: configPath, content: "version: 1\n" })).resolves.toBe(true);
    await expect(writeTextArtifactIfMissing({ artifacts, artifactPath: configPath, content: "version: 2\n" })).resolves.toBe(false);

    await expect(readFile(configPath, "utf8")).resolves.toBe("version: 1\n");
  });

  it("appends text artifacts inside the agent workspace", async () => {
    const artifacts = await createTempArtifacts();
    const logPath = path.join(artifacts.logsDir, "init.log");

    await appendTextArtifact({ artifacts, artifactPath: logPath, content: "first\n" });
    await appendTextArtifact({ artifacts, artifactPath: logPath, content: "second\n" });

    await expect(readFile(logPath, "utf8")).resolves.toBe("first\nsecond\n");
  });
});

async function createTempArtifacts(): Promise<AgentArtifacts> {
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
    semanticDir: path.join(agentRoot, "semantic"),
    viewsDir: path.join(agentRoot, "views"),
  };
}
