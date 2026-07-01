import path from "node:path";
import { promises as fs } from "node:fs";

export async function resolveExistingDirectory(inputPath: string): Promise<string> {
  const resolved = path.resolve(inputPath);
  const stat = await fs.stat(resolved).catch(() => undefined);

  if (!stat) {
    throw new Error(`Path does not exist: ${resolved}`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolved}`);
  }

  return resolved;
}

export function assertInsideDirectory(parentDir: string, targetPath: string): void {
  const parent = path.resolve(parentDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(parent, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes allowed directory: ${target}`);
  }
}

export function assertAgentWorkspaceWrite(vaultPath: string, targetPath: string): void {
  const agentRoot = path.join(path.resolve(vaultPath), ".agent");
  assertInsideDirectory(agentRoot, targetPath);
}
