import path from "node:path";
import { promises as fs } from "node:fs";
import type { VaultScan } from "../domain/vault.js";
import { resolveExistingDirectory } from "../safety/pathSafety.js";
import { scanVault } from "../vault/scanner.js";
import { ensureAgentWorkspace } from "../workspace/agentWorkspace.js";

export type StatusWorkflowInput = {
  vaultPath: string;
  scopePath?: string;
};

export type StatusWorkflowResult = {
  scan: VaultScan;
  lastScanPath: string;
};

export async function runStatusWorkflow(input: StatusWorkflowInput): Promise<StatusWorkflowResult> {
  const vaultPath = await resolveExistingDirectory(input.vaultPath);
  const workspace = await ensureAgentWorkspace(vaultPath);
  const scan = await scanVault({ vaultPath, scopePath: input.scopePath });
  const lastScanPath = path.join(workspace.metadataDir, "last-scan.json");
  await fs.writeFile(lastScanPath, `${JSON.stringify(scan, null, 2)}\n`, "utf8");

  return { scan, lastScanPath };
}

export function formatStatus(result: StatusWorkflowResult): string {
  const { scan } = result;
  const dirs = scan.stats.topLevelDirectories
    .slice(0, 8)
    .map((dir) => `- ${dir.path}: ${dir.fileCount} files (${dir.markdownCount} md)`)
    .join("\n");
  const recent = scan.stats.recentlyChangedFiles.map((file) => `- ${file}`).join("\n");

  return [
    "Vault Status",
    "",
    `Vault: ${scan.vaultPath}`,
    scan.scopePath ? `Scope: ${scan.scopePath}` : undefined,
    `Scanned at: ${scan.scannedAt}`,
    "",
    `Total files: ${scan.stats.totalFiles}`,
    `Markdown files: ${scan.stats.markdownFiles}`,
    `PDF files: ${scan.stats.pdfFiles}`,
    `Images: ${scan.stats.imageFiles}`,
    `Other files: ${scan.stats.otherFiles}`,
    "",
    "Top areas:",
    dirs || "- none",
    "",
    "Recently changed:",
    recent || "- none",
    "",
    `Scan cache: ${result.lastScanPath}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}
