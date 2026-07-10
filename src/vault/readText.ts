import { promises as fs } from "node:fs";
import path from "node:path";
import { safeVaultPath } from "../safety/pathSafety.js";

const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

export type VaultText = {
  filePath: string;
  mediaType: "markdown" | "text";
  content: string;
  lineCount: number;
};

/** Read a UTF-8 Markdown/plain-text vault file without allowing path escape. */
export async function readVaultText(vaultPath: string, filePath: string): Promise<VaultText> {
  const absolutePath = safeVaultPath(vaultPath, filePath);
  const extension = path.extname(filePath).toLowerCase();
  if (!absolutePath) throw new Error("unsafe_path");
  if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error("unsupported_text_type");

  const content = await fs.readFile(absolutePath, "utf8");
  return {
    filePath,
    mediaType: extension === ".txt" ? "text" : "markdown",
    content,
    lineCount: content === "" ? 0 : content.split(/\r?\n/).length,
  };
}
