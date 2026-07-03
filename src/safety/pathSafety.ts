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

export function assertAgentArtifactsWrite(agentRootPath: string, targetPath: string): void {
  assertInsideDirectory(agentRootPath, targetPath);
}

/**
 * Resolve a vault-relative path to an absolute path, but only if it stays inside
 * the vault. Returns `null` for anything unsafe — an absolute input, a `..`
 * traversal that escapes the root, or the vault root itself. This is the guard
 * every proposal executor runs on payload paths so an approved change can never
 * touch a file outside the vault.
 */
export function safeVaultPath(vaultPath: string, relPath: string): string | null {
  if (!relPath || path.isAbsolute(relPath)) return null;
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(root, relPath);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}
