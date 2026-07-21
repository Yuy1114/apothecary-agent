import { promises as fs } from "node:fs";
import path from "node:path";
import { scanVault } from "../../vault/scanner.js";
import { VAULT_IGNORE_GLOBS } from "../../domain/vaultPolicy.js";
import { classifyLayer } from "../../vault/classifyLayer.js";
import {
  auditReadme,
  parseReadmeEntries,
  reconcileReadme,
  type ActualNote,
  type ReadmeIssue,
} from "../../vault/readmeAudit.js";
import { createProposal, listProposals, saveProposal } from "../../vault/proposalStore.js";
import { resolveProposalRecord } from "../../domain/proposal.js";
import { apothecaryHome } from "../../config/apothecaryHome.js";
import { nowIso } from "../../utils/time.js";

/** One directory whose README index disagrees with the notes on disk. */
export type DirectoryAudit = {
  dir: string;
  readmePath: string;
  issues: ReadmeIssue[];
  /** The corrected README content an `edit` proposal would apply. */
  reconciledContent: string;
};

// Audit proposals are titled with this stable prefix so a re-run can supersede
// its own still-pending proposals for the same README without touching unrelated
// edits.
const AUDIT_TITLE_PREFIX = "校正索引";

function toPosix(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

function dirOf(relPath: string): string {
  const dir = path.posix.dirname(toPosix(relPath));
  return dir === "." ? "" : dir;
}

/**
 * A directory is worth auditing when it's a filed layer that carries a note
 * index. The vault root (a hand-authored landing page), the transient `_inbox`,
 * the archive, and the agent home are deliberately left alone.
 */
function shouldAuditDir(dir: string): boolean {
  if (dir === "") return false;
  const layer = classifyLayer(dir);
  return layer !== "inbox" && layer !== "archive" && layer !== "agent" && layer !== "unknown";
}

async function readOrNull(filePath: string): Promise<string | null> {
  return fs.readFile(filePath, "utf8").catch(() => null);
}

/**
 * Reconcile every filed directory's README note index against the notes actually
 * present, returning one entry per directory that has a drift. Read-only: it
 * computes the corrected content but writes nothing (execution is a per-directory
 * `edit` proposal, gated on approval).
 */
export async function auditReadmeConsistency(vaultPath: string): Promise<DirectoryAudit[]> {
  const scan = await scanVault({ vaultPath, includeHash: false, ignore: VAULT_IGNORE_GLOBS });

  // Notes present per directory, plus every directory that already holds a README
  // (so a folder whose notes all vanished but whose index still lists them — pure
  // stale — is caught too).
  const notesByDir = new Map<string, ActualNote[]>();
  const dirsWithReadme = new Set<string>();
  for (const file of scan.files) {
    if (file.mediaType !== "markdown") continue;
    const base = path.posix.basename(toPosix(file.path));
    const dir = dirOf(file.path);
    if (base === "README.md") {
      dirsWithReadme.add(dir);
      continue;
    }
    const note: ActualNote = {
      fileName: base,
      title: file.title?.trim() || base,
      date: new Date(file.createdAt ?? Date.now()).toLocaleDateString("zh-CN"),
    };
    const list = notesByDir.get(dir);
    if (list) list.push(note);
    else notesByDir.set(dir, [note]);
  }

  const dirs = new Set<string>([...notesByDir.keys(), ...dirsWithReadme]);
  const audits: DirectoryAudit[] = [];
  for (const dir of [...dirs].sort()) {
    if (!shouldAuditDir(dir)) continue;
    const actual = notesByDir.get(dir) ?? [];
    const readmeRel = path.posix.join(dir, "README.md");
    const content = await readOrNull(path.join(vaultPath, dir, "README.md"));
    const issues = auditReadme({ entries: parseReadmeEntries(content ?? ""), actual });
    if (issues.length === 0) continue;
    const reconciledContent = reconcileReadme({
      content,
      issues,
      actual,
      label: dir.split("/").at(-1) ?? dir,
    });
    // A no-op reconcile (nothing the transforms could change) is not worth a
    // proposal — guard against proposing an identical rewrite.
    if (reconciledContent === (content ?? "")) continue;
    audits.push({ dir, readmePath: readmeRel, issues, reconciledContent });
  }
  return audits;
}

function summarizeIssues(issues: ReadmeIssue[]): string {
  const counts = { stale: 0, missing: 0, title_mismatch: 0 };
  for (const issue of issues) counts[issue.kind] += 1;
  const parts: string[] = [];
  if (counts.missing) parts.push(`补录 ${counts.missing}`);
  if (counts.stale) parts.push(`清理失效 ${counts.stale}`);
  if (counts.title_mismatch) parts.push(`更正标题 ${counts.title_mismatch}`);
  return parts.join(" · ") || "无";
}

function issueDetail(issue: ReadmeIssue): string {
  if (issue.kind === "stale") return `失效条目 ${issue.fileName}（文件已不在，索引仍列着）`;
  if (issue.kind === "missing") return `缺失条目 ${issue.fileName}（文件存在，索引未列）`;
  return `标题不符 ${issue.fileName}（索引「${issue.readmeTitle}」→ 实际「${issue.actualTitle}」）`;
}

export type ProposeReadmeFixesResult = {
  directoriesWithIssues: number;
  proposalIds: string[];
  /** Per-directory summary for the agent to report back to the user. */
  findings: Array<{ dir: string; summary: string }>;
};

/**
 * Full README-consistency sweep: audit every filed directory and raise one
 * `edit` proposal per drifted README (rewriting only its index). Nothing moves
 * or changes until the human approves each proposal. A re-run supersedes its own
 * still-pending proposals for the same README so they don't pile up.
 */
export async function proposeReadmeFixes(
  vaultPath: string,
  home: string = apothecaryHome(),
): Promise<ProposeReadmeFixesResult> {
  const audits = await auditReadmeConsistency(vaultPath);
  const pendingEdits = await listProposals(home, { status: "proposed", type: "edit" });
  const proposalIds: string[] = [];
  const findings: Array<{ dir: string; summary: string }> = [];

  for (const audit of audits) {
    // Supersede a still-pending audit proposal for this same README (newer disk
    // state wins); leave any unrelated edit proposal alone.
    for (const stale of pendingEdits) {
      if ((stale.payload as { filePath?: string }).filePath === audit.readmePath && stale.title.startsWith(AUDIT_TITLE_PREFIX)) {
        await saveProposal(home, resolveProposalRecord(stale, "rejected", "superseded_by_newer_readme_audit", nowIso()));
      }
    }
    const summary = summarizeIssues(audit.issues);
    const proposal = await createProposal(home, {
      type: "edit",
      title: `${AUDIT_TITLE_PREFIX} ${audit.readmePath}：${summary}`,
      rationale:
        `目录 ${audit.dir} 的 README 索引与实际文件不一致，自动核对得出以下修正：\n` +
        audit.issues.map((issue) => `· ${issueDetail(issue)}`).join("\n") +
        `\n采纳后只重写该 README 的索引行，其余内容保留。`,
      payload: { filePath: audit.readmePath, suggestedContent: audit.reconciledContent },
    });
    proposalIds.push(proposal.id);
    findings.push({ dir: audit.dir, summary });
  }

  return { directoriesWithIssues: audits.length, proposalIds, findings };
}
