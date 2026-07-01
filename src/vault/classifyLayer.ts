import path from "node:path";
import type { VaultLayer } from "../domain/vault.js";

export function classifyLayer(relativePath: string): VaultLayer {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  const first = parts[0]?.toLowerCase();

  if (!first) return "unknown";
  if (first === ".agent") return "agent";
  if (first.includes("inbox") || first === "00_inbox") return "inbox";
  if (first === "raw") return "raw";
  if (first === "wiki") return "wiki";
  if (first === "outputs" || first === "output") return "outputs";
  if (first.includes("archive") || first === "90_archive") return "archive";

  const normalized = relativePath.toLowerCase();
  if (normalized.includes(`${path.sep}.agent${path.sep}`)) return "agent";

  return "unknown";
}
