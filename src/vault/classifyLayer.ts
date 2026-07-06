import path from "node:path";
import type { VaultLayer } from "../domain/vault.js";

/**
 * Classify a vault-relative path into its top-level layer. Mirrors the frozen
 * vault skeleton: _inbox / journal / notes / projects / areas / resources /
 * records / media / archive. The agent's own home (`.apothecary`/legacy
 * `.agent`) lives outside the vault, but is still recognised defensively.
 */
export function classifyLayer(relativePath: string): VaultLayer {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  const first = parts[0]?.toLowerCase();

  if (!first) return "unknown";
  if (first === ".apothecary" || first === ".agent") return "agent";
  if (first === "_inbox" || first.includes("inbox")) return "inbox";
  if (first === "journal") return "journal";
  if (first === "notes") return "notes";
  if (first === "projects") return "projects";
  if (first === "areas") return "areas";
  if (first === "resources") return "resources";
  if (first === "records") return "records";
  if (first === "media") return "media";
  if (first === "archive" || first.includes("archive")) return "archive";

  const normalized = relativePath.toLowerCase();
  if (normalized.includes(`${path.sep}.apothecary${path.sep}`)) return "agent";
  if (normalized.includes(`${path.sep}.agent${path.sep}`)) return "agent";

  return "unknown";
}
