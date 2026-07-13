import { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "./markdown.js";

type View = "workspace" | "vault" | "runs" | "knowledge" | "settings";
type Message = { role: "user" | "assistant"; content: string };
type ProposalStatus = "proposed" | "applied" | "rejected";
type RunTool = { toolCallId: string; toolName: string; status: "running" | "completed" | "failed" };
type RunProposal = ProposalDecisionState & { decision?: "approving" | "applied" | "rejected" | "failed"; decisionDetail?: string };
type RunApproval = { toolCallId: string; toolName: string; decision?: "approving" | "approved" | "declined" };
type AgentRun = {
  id: string;
  text: string;
  status: "running" | "awaiting" | "completed" | "failed";
  label: string;
  tools: RunTool[];
  proposals: RunProposal[];
  approvals: RunApproval[];
};
type TimelineItem = { kind: "user"; id: string; content: string } | { kind: "run"; run: AgentRun };
type DesktopThread = { id: string; title: string; createdAt: string; updatedAt: string; preview?: string };

const api = window.apothecary;

const titles: Record<View, [string, string]> = {
  workspace: ["工作区 Workspace", "对话 · 提案 · 运行动态"],
  vault: ["Vault 文件库", "最近 · Inbox · 变更 · 监听中"],
  runs: ["审阅 Review", "检查并复核 Agent 对药柜的改动"],
  knowledge: ["知识体系 Knowledge", "主题域 · 关系 · 维护机会"],
  settings: ["设置 Settings", "本地配置 · 不会上传"],
};

const formatDate = (value?: string) =>
  value ? new Date(value).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const lastSegment = (p?: string) => (p ? p.split(/[\\/]/).filter(Boolean).at(-1) ?? p : "");
/** Peel a leading `---\n…\n---` YAML frontmatter block off note content. */
const splitFrontmatter = (content: string): { frontmatter: string | null; body: string } => {
  const match = /^---\n([\s\S]*?)\n---\s*\n?/.exec(content ?? "");
  return match ? { frontmatter: match[1].trim(), body: content.slice(match[0].length) } : { frontmatter: null, body: content ?? "" };
};

/* ── Icons (16-viewBox strokes, matching the imported design) ────────── */
const S = (d: string, size = 15) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const Icon = {
  workspace: () => S("M14 10.5a1.5 1.5 0 0 1-1.5 1.5H5l-3 2.5V3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v7z"),
  vault: () => S("M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 2h4.5A1.5 1.5 0 0 1 14 6.5v5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7z"),
  runs: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.2" /><path d="M8 4.8V8l2.2 1.4" />
    </svg>
  ),
  knowledge: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="3.2" r="1.7" /><circle cx="3.2" cy="11.8" r="1.7" /><circle cx="12.8" cy="11.8" r="1.7" /><path d="M7.1 4.7 4 10.3M8.9 4.7l3.1 5.6M4.9 11.8h6.2" />
    </svg>
  ),
  settings: () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.2" /><path d="M13.2 9.9a1.2 1.2 0 0 0 .24 1.32l.04.05a1.45 1.45 0 1 1-2.05 2.05l-.05-.04a1.2 1.2 0 0 0-1.32-.24 1.2 1.2 0 0 0-.73 1.1v.13a1.45 1.45 0 0 1-2.9 0v-.07a1.2 1.2 0 0 0-.79-1.1 1.2 1.2 0 0 0-1.32.24l-.05.04a1.45 1.45 0 1 1-2.05-2.05l.04-.05a1.2 1.2 0 0 0 .24-1.32 1.2 1.2 0 0 0-1.1-.73h-.13a1.45 1.45 0 0 1 0-2.9h.07a1.2 1.2 0 0 0 1.1-.79 1.2 1.2 0 0 0-.24-1.32l-.04-.05A1.45 1.45 0 1 1 4.27 2.1l.05.04a1.2 1.2 0 0 0 1.32.24h.06a1.2 1.2 0 0 0 .73-1.1v-.13a1.45 1.45 0 0 1 2.9 0v.07a1.2 1.2 0 0 0 .73 1.1 1.2 1.2 0 0 0 1.32-.24l.05-.04a1.45 1.45 0 1 1 2.05 2.05l-.04.05a1.2 1.2 0 0 0-.24 1.32v.06a1.2 1.2 0 0 0 1.1.73h.13a1.45 1.45 0 0 1 0 2.9h-.07a1.2 1.2 0 0 0-1.1.73z" />
    </svg>
  ),
  file: () => (
    <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 1.5h-5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5l-3.5-3.5z" /><path d="M9.5 1.5V5H13" />
    </svg>
  ),
  refresh: () => S("M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.6h-2.6", 14),
  close: () => S("m4 4 8 8M12 4l-8 8", 14),
  chevron: () => S("m4 6 4 4 4-4", 14),
};

function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

// Electron disables window.prompt(), so the reject-reason input is an in-app
// dialog. Returns null when cancelled, the (possibly empty) reason when confirmed.
function useReasonPrompt() {
  const [pending, setPending] = useState<{ message: string; resolve: (value: string | null) => void } | null>(null);
  const [value, setValue] = useState("");
  const prompt = useCallback(
    (message: string) => new Promise<string | null>((resolve) => { setValue(""); setPending({ message, resolve }); }),
    [],
  );
  const close = (result: string | null) => { pending?.resolve(result); setPending(null); };
  const dialog = pending ? (
    <div className="overlay" onMouseDown={() => close(null)}>
      <div className="modal" style={{ width: "min(440px, 100%)" }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-body">
          <p style={{ margin: 0, fontSize: 13.5 }}>{pending.message}</p>
          <textarea className="textarea" rows={3} autoFocus value={value} onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") close(null); if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) close(value.trim()); }} />
        </div>
        <div className="modal-foot" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost sm" onClick={() => close(null)}>取消</button>
          <button className="btn btn-danger sm" onClick={() => close(value.trim())}>确认拒绝</button>
        </div>
      </div>
    </div>
  ) : null;
  return { prompt, dialog };
}

export function App() {
  const [view, setView] = useState<View>("workspace");
  const [dashboard, setDashboard] = useState<any>(null);
  const [toast, setToast] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [queuedPrompt, setQueuedPrompt] = useState("");
  const [diffProposal, setDiffProposal] = useState<any>(null);
  const [vaultScope, setVaultScope] = useState<string>("inbox");
  // A request to open a specific note in the Vault view (from a RAG source chip
  // or an in-answer link). The nonce forces VaultView to re-open even if the same
  // path is clicked twice.
  const [vaultTarget, setVaultTarget] = useState<{ path: string; nonce: number } | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }, []);
  const refreshDashboard = useCallback(async () => setDashboard(await api.dashboard()), []);
  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1);
    void refreshDashboard().catch((error) => notify(`加载失败：${error.message}`));
  }, [notify, refreshDashboard]);

  useEffect(() => { void refreshDashboard().catch((error) => notify(error.message)); }, [notify, refreshDashboard]);
  useEffect(() => {
    const timer = window.setInterval(() => void refreshDashboard().catch(() => undefined), 4000);
    return () => window.clearInterval(timer);
  }, [refreshDashboard]);

  const [threads, setThreads] = useState<DesktopThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threadNonce, setThreadNonce] = useState(0);
  const loadThreads = useCallback(() => api.threads().then(setThreads).catch(() => undefined), []);
  useEffect(() => { void loadThreads(); }, [loadThreads]);

  const openChat = useCallback((prompt: string) => { setQueuedPrompt(prompt); setView("workspace"); }, []);
  // Jump to a note in the Vault view: scope the tree to its top-level folder and
  // ask VaultView to open the exact file.
  const openInVault = useCallback((filePath: string) => {
    const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
    const top = normalized.split("/")[0];
    setVaultScope(top === "_inbox" ? "inbox" : top || "inbox");
    setVaultTarget({ path: normalized, nonce: Date.now() });
    setView("vault");
  }, []);
  // Explicit conversation switches bump threadNonce so WorkspaceView reloads;
  // a locally-minted thread (onThreadCreated) must NOT bump it, or the in-flight
  // timeline would be wiped by a reload.
  const selectThread = useCallback((id: string) => { setActiveThreadId(id); setThreadNonce((n) => n + 1); setView("workspace"); }, []);
  const newThread = useCallback(() => { setActiveThreadId(null); setThreadNonce((n) => n + 1); setView("workspace"); }, []);
  const onThreadCreated = useCallback((id: string) => { setActiveThreadId(id); void loadThreads(); }, [loadThreads]);
  const deleteThread = useCallback(async (id: string) => {
    await api.deleteThread(id);
    if (activeThreadId === id) newThread();
    await loadThreads();
  }, [activeThreadId, newThread, loadThreads]);

  const [eyebrowTitle, eyebrowDesc] = titles[view];

  return (
    <div className="win">
      <aside className="sidebar">
        <div className="sidebar-top" />
        <nav className="nav" aria-label="主要导航">
          <NavItem id="workspace" icon={<Icon.workspace />} label="工作区 Workspace" active={view} onClick={setView} badge={dashboard?.pendingProposals} />
          <NavItem id="vault" icon={<Icon.vault />} label="Vault" active={view} onClick={setView} badge={dashboard?.pendingChanges} />
          <NavItem id="runs" icon={<Icon.runs />} label="审阅 Review" active={view} onClick={setView} />
          <NavItem id="knowledge" icon={<Icon.knowledge />} label="知识体系 Knowledge" active={view} onClick={setView} />
        </nav>

        <SidePanel view={view} dashboard={dashboard} refreshKey={refreshKey} vaultScope={vaultScope} setVaultScope={setVaultScope}
          threads={threads} activeThreadId={activeThreadId} onSelectThread={selectThread} onNewThread={newThread} onDeleteThread={deleteThread} />

        <div className="side-foot">
          <nav className="nav">
            <NavItem id="settings" icon={<Icon.settings />} label="设置 Settings" active={view} onClick={setView} />
          </nav>
          <div className="sync-status">
            <span className={`dot ${dashboard ? "" : "off"}`} />
            <span className="t">{dashboard ? "监听中 · 已连接" : "连接中…"}</span>
            <button className="btn btn-ghost sm icon" title="手动同步 / 刷新" onClick={refresh}><Icon.refresh /></button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <span className="title">{eyebrowTitle}</span>
          <span className="desc">{eyebrowDesc}</span>
          <span className="spacer" />
          <button className="btn btn-ghost sm icon" title="刷新当前页面" onClick={refresh}><Icon.refresh /></button>
        </header>

        {view === "workspace" && <WorkspaceView refreshKey={refreshKey} dashboard={dashboard} refreshDashboard={refreshDashboard} queuedPrompt={queuedPrompt} clearQueuedPrompt={() => setQueuedPrompt("")} notify={notify} openDiff={setDiffProposal}
          activeThreadId={activeThreadId} threadNonce={threadNonce} onThreadCreated={onThreadCreated} refreshThreads={loadThreads} openInVault={openInVault} />}
        {view === "vault" && <VaultView scope={vaultScope} refreshKey={refreshKey} onChat={openChat} notify={notify} target={vaultTarget} />}
        {view === "runs" && <ReviewView refreshKey={refreshKey} onChat={openChat} notify={notify} />}
        {view === "knowledge" && <KnowledgeView refreshKey={refreshKey} onChat={openChat} />}
        {view === "settings" && <SettingsView refreshKey={refreshKey} notify={notify} />}
      </main>

      {diffProposal && <DiffModal proposal={diffProposal} onClose={() => setDiffProposal(null)} />}
      <div className={`toast ${toast ? "show" : ""}`} role="status">{toast}</div>
    </div>
  );
}

function NavItem({ id, icon, label, active, onClick, badge, count }: {
  id: View; icon: ReactNode; label: string; active: View; onClick: (v: View) => void; badge?: number; count?: number;
}) {
  return (
    <button className={`nav-item ${active === id ? "active" : ""}`} onClick={() => onClick(id)}>
      {icon}
      <span className="label">{label}</span>
      {count != null && <span className="count">{count}</span>}
      {badge != null && badge > 0 && <span className="badge accent">{badge}</span>}
    </button>
  );
}

const QUICK_PROMPTS: Array<[string, string]> = [
  ["检查最近变更", "有哪些文件发生了变更？请帮我判断应该如何处理。"],
  ["整理 Inbox", "请扫描 inbox，并建议这些文件应该归位到哪里。"],
  ["查看知识画像", "根据当前药柜，总结我的核心知识主题和薄弱区域。"],
];

function SidePanel({ view, dashboard, refreshKey, vaultScope, setVaultScope, threads, activeThreadId, onSelectThread, onNewThread, onDeleteThread }: {
  view: View; dashboard: any; refreshKey: number; vaultScope: string; setVaultScope: (s: string) => void;
  threads: DesktopThread[]; activeThreadId: string | null; onSelectThread: (id: string) => void; onNewThread: () => void; onDeleteThread: (id: string) => void;
}) {
  if (view === "workspace") {
    return (
      <div className="side-panel">
        <div className="side-head"><span>对话历史</span><span className="side-action" onClick={onNewThread}>+ 新对话</span></div>
        <div className="side-list">
          {threads.length === 0 ? <div className="side-empty">还没有对话。发送第一条消息开始。</div> : threads.map((t) => (
            <div className={`side-row ${activeThreadId === t.id ? "active" : ""}`} key={t.id} onClick={() => onSelectThread(t.id)}>
              <div className="side-row-top">
                <span className="t">{t.title}</span>
                <span className="time">{formatDate(t.updatedAt)}</span>
                <button className="row-del" title="删除对话" onClick={(e) => { e.stopPropagation(); if (window.confirm(`删除对话「${t.title}」？`)) void onDeleteThread(t.id); }}>×</button>
              </div>
              {t.preview && <span className="sub">{t.preview}</span>}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (view === "vault") {
    return <VaultTreePanel scope={vaultScope} setScope={setVaultScope} dashboard={dashboard} refreshKey={refreshKey} />;
  }
  const ops: any[] = dashboard?.recentOperations ?? [];
  return (
    <div className="side-panel">
      <div className="side-head"><span>最近活动</span></div>
      <div className="side-list">
        {ops.length === 0 ? <div className="side-empty">暂无活动</div> : ops.slice(0, 8).map((op) => (
          <div className="side-row" key={op.id}>
            <div className="side-row-top"><span className="t">{op.type}</span><span className="time">{formatDate(op.appliedAt)}</span></div>
            <span className="sub">{op.targetFiles?.map(lastSegment).join(", ") || op.detail || op.source}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const INBOX_DIR_NAMES = ["inbox", "_inbox"];

function VaultTreePanel({ scope, setScope, dashboard, refreshKey }: { scope: string; setScope: (s: string) => void; dashboard: any; refreshKey: number }) {
  const [tree, setTree] = useState<{ directories: any[]; totalFiles: number } | null>(null);
  const [inboxCount, setInboxCount] = useState<number | null>(null);
  useEffect(() => {
    void api.vaultTree().then(setTree).catch(() => setTree({ directories: [], totalFiles: 0 }));
    void api.inbox().then((f) => setInboxCount(f.length)).catch(() => setInboxCount(null));
  }, [refreshKey]);
  const dirs = (tree?.directories ?? []).filter((d) => !INBOX_DIR_NAMES.includes(d.path.toLowerCase()));
  return (
    <div className="side-panel">
      <div className="side-head"><span>Vault</span><span className="count mono">{tree ? `${tree.totalFiles} 篇` : "…"}</span></div>
      <div className="side-list">
        <div className={`tree-row ${scope === "recent" ? "active" : ""}`} onClick={() => setScope("recent")}>
          <Icon.runs /><span className="label">最近</span>
        </div>
        <div className={`tree-row ${scope === "inbox" ? "active" : ""}`} onClick={() => setScope("inbox")}>
          <Icon.file /><span className="label">_inbox</span>
          {inboxCount != null && inboxCount > 0 && <span className="badge accent">{inboxCount} 待处理</span>}
        </div>
        <div className={`tree-row ${scope === "changes" ? "active" : ""}`} onClick={() => setScope("changes")}>
          <Icon.refresh /><span className="label">变更</span>
          {dashboard?.pendingChanges > 0 && <span className="badge warning">{dashboard.pendingChanges}</span>}
        </div>
        {dirs.map((d) => (
          <div key={d.path} className={`tree-row ${scope === d.path ? "active" : ""}`} onClick={() => setScope(d.path)}>
            <Icon.vault /><span className="label">{d.path}</span><span className="count">{d.fileCount}</span>
          </div>
        ))}
        {dirs.length === 0 && tree && <div className="side-empty">Vault 里还没有其它文件夹。</div>}
      </div>
    </div>
  );
}

/* ═══ Workspace ═══════════════════════════════════════════════════════ */
function WorkspaceView({ refreshKey, dashboard, refreshDashboard, queuedPrompt, clearQueuedPrompt, notify, openDiff, activeThreadId, threadNonce, onThreadCreated, refreshThreads, openInVault }: {
  refreshKey: number; dashboard: any; refreshDashboard: () => Promise<void>; queuedPrompt: string; clearQueuedPrompt: () => void; notify: (t: string) => void; openDiff: (p: any) => void;
  activeThreadId: string | null; threadNonce: number; onThreadCreated: (id: string) => void; refreshThreads: () => void; openInVault: (path: string) => void;
}) {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // @-mention: the vault note list (loaded once) and the in-progress `@query`
  // token being typed, plus the notes the user has referenced so their paths can
  // be handed to the agent on send.
  const [allNotes, setAllNotes] = useState<Array<{ path: string; title: string }>>([]);
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null);
  const refsRef = useRef<Array<{ title: string; path: string }>>([]);
  useEffect(() => { void api.notes().then(setAllNotes).catch(() => undefined); }, [refreshKey]);
  const mentionMatches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return allNotes
      .filter((note) => !q || note.title.toLowerCase().includes(q) || note.path.toLowerCase().includes(q))
      .slice(0, 8);
  }, [mention, allNotes]);

  // Re-scan for an active `@token` ending at the caret whenever the text/caret moves.
  const syncMention = (value: string, caret: number) => {
    const match = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    setMention(match ? { start: caret - match[1].length - 1, query: match[1], index: 0 } : null);
  };
  const applyMention = (note: { path: string; title: string }) => {
    if (!mention) return;
    const before = input.slice(0, mention.start);
    const after = input.slice(mention.start + 1 + mention.query.length);
    const insert = `@${note.title} `;
    setInput(before + insert + after);
    if (!refsRef.current.some((r) => r.path === note.path)) refsRef.current.push({ title: note.title, path: note.path });
    setMention(null);
    const caret = (before + insert).length;
    requestAnimationFrame(() => { const ta = inputRef.current; if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = caret; } });
  };
  // The conversation this view is sending into; a local mint on first send does
  // not go through activeThreadId re-render, so keep the live id in a ref.
  const threadRef = useRef<string | null>(activeThreadId);
  const { prompt: reasonPrompt, dialog: reasonDialog } = useReasonPrompt();
  const busy = timeline.some((item) => item.kind === "run" && (item.run.status === "running" || item.run.status === "awaiting"));

  // Reload the timeline when the user explicitly switches / starts a conversation
  // (threadNonce bumps). Historical assistant turns replay as plain completed
  // bubbles — tool steps and proposals are live-only.
  useEffect(() => {
    threadRef.current = activeThreadId;
    if (!activeThreadId) { setTimeline([]); return; }
    let cancelled = false;
    void api.threadMessages(activeThreadId).then((msgs) => {
      if (cancelled) return;
      setTimeline(msgs.map((m) => m.role === "user"
        ? { kind: "user", id: crypto.randomUUID(), content: m.content }
        : { kind: "run", run: { id: crypto.randomUUID(), text: m.content, status: "completed", label: "", tools: [], proposals: [], approvals: [] } }));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [threadNonce]);

  const loadPending = useCallback(() => api.proposals("proposed").then(setPending).catch(() => undefined), []);
  useEffect(() => { void loadPending(); }, [loadPending, refreshKey, dashboard?.pendingProposals]);

  // Proposals awaited inside a live run must be resolved via resumeRun (to unblock
  // the suspended run), so exclude them from the standalone "agent event" list to
  // avoid double display and stuck runs.
  const liveProposalIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of timeline) if (item.kind === "run") for (const p of item.run.proposals) ids.add(p.proposalId);
    return ids;
  }, [timeline]);
  const standalone = pending.filter((p) => !liveProposalIds.has(p.id));

  useEffect(() => api.onRunEvent(({ runId, event }) => {
    setTimeline((items) => items.map((item) => {
      if (item.kind !== "run" || item.run.id !== runId) return item;
      const run = item.run;
      if (event.type === "text_delta") return { ...item, run: { ...run, text: run.text + event.text } };
      if (event.type === "status") return { ...item, run: { ...run, label: event.label } };
      if (event.type === "tool_started") return { ...item, run: { ...run, label: `正在使用 ${event.toolName}`, tools: [...run.tools, { toolCallId: event.toolCallId, toolName: event.toolName, status: "running" }] } };
      if (event.type === "tool_completed") return { ...item, run: { ...run, tools: run.tools.map((tool) => tool.toolCallId === event.toolCallId ? { ...tool, status: event.failed ? "failed" : "completed" } : tool) } };
      if (event.type === "awaiting_decision") return { ...item, run: { ...run, status: "awaiting", label: "等待你确认提案", proposals: [...run.proposals, event.proposal] } };
      if (event.type === "awaiting_approval") return { ...item, run: { ...run, status: "awaiting", label: `等待你批准执行 ${event.toolName}`, approvals: [...run.approvals, { toolCallId: event.toolCallId, toolName: event.toolName }] } };
      if (event.type === "completed") return { ...item, run: { ...run, status: "completed", label: run.proposals.some((proposal) => !proposal.decision) ? "等待你的决定" : "Agent Run 已完成" } };
      if (event.type === "failed") return { ...item, run: { ...run, status: "failed", label: event.message } };
      return item;
    }));
    if (event.type === "completed" || event.type === "failed") { void refreshDashboard(); refreshThreads(); }
  }), [refreshDashboard, refreshThreads]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [timeline]);

  const conversationFrom = (items: TimelineItem[]): Message[] => items.reduce<Message[]>((messages, item) => {
    if (item.kind === "user") messages.push({ role: "user", content: item.content });
    else if (item.run.text) messages.push({ role: "assistant", content: item.run.text });
    return messages;
  }, []).slice(-19);

  const send = async (text: string) => {
    const typed = text.trim(); if (!typed || busy) return;
    // Hand the agent the concrete paths of any notes the user @-referenced (kept
    // only if the mention still survives in the text), so it can read them directly.
    const activeRefs = refsRef.current.filter((ref) => typed.includes(`@${ref.title}`));
    const content = activeRefs.length
      ? `${typed}\n\n（请重点参考这些笔记：${activeRefs.map((ref) => ref.path).join("、")}）`
      : typed;
    refsRef.current = [];
    const runId = crypto.randomUUID();
    const userItem: TimelineItem = { kind: "user", id: crypto.randomUUID(), content };
    const runItem: TimelineItem = { kind: "run", run: { id: runId, text: "", status: "running", label: "正在启动 Agent Run", tools: [], proposals: [], approvals: [] } };
    setTimeline((items) => [...items, userItem, runItem]); setInput(""); setMention(null);
    // First message of a fresh conversation mints and titles a thread so it
    // shows up in history immediately; subsequent turns reuse it.
    let threadId = threadRef.current;
    const isNew = !threadId;
    if (!threadId) { threadId = crypto.randomUUID(); threadRef.current = threadId; }
    try {
      if (isNew) {
        await api.createThread(threadId, content.slice(0, 30));
        onThreadCreated(threadId);
      }
      await api.startRun(runId, [...conversationFrom(timeline), { role: "user", content }], threadId);
    } catch (error) {
      setTimeline((items) => items.map((item) => item.kind === "run" && item.run.id === runId ? { ...item, run: { ...item.run, status: "failed", label: (error as Error).message } } : item));
    }
  };

  const resolveInlineProposal = async (runId: string, proposal: RunProposal, decision: "approve" | "reject") => {
    if (decision === "approve" && !window.confirm(`批准提案「${proposal.title}」并应用？`)) return;
    let note: string | undefined;
    if (decision === "reject") {
      const reason = await reasonPrompt(`拒绝提案「${proposal.title}」的原因（可选）`);
      if (reason === null) return;
      note = reason || undefined;
    }
    setTimeline((items) => items.map((item) =>
      item.kind === "run" && item.run.id === runId
        ? { ...item, run: { ...item.run, status: "running", label: decision === "approve" ? "正在应用并继续…" : "正在继续…", proposals: item.run.proposals.map((existing) => existing.proposalId === proposal.proposalId ? { ...existing, decision: "approving" } : existing) } }
        : item));
    const result = await api.resumeRun(runId, proposal.proposalId, decision, note);
    const finalDecision = !result.resolved ? "failed" : decision === "approve" ? "applied" : "rejected";
    setTimeline((items) => updateRunProposal(items, runId, proposal.proposalId, { decision: finalDecision, decisionDetail: result.reason }));
    await refreshDashboard();
  };

  // Native tool-approval gate (e.g. executeIntake). Approve => the tool runs and
  // the run continues; decline => the run continues with the tool skipped. The
  // continuation streams onto this same run bubble via onRunEvent.
  const resolveApproval = async (runId: string, approval: RunApproval, decision: "approve" | "decline") => {
    if (decision === "approve" && !window.confirm(`批准 Agent 执行 ${approval.toolName}？`)) return;
    setTimeline((items) => items.map((item) =>
      item.kind === "run" && item.run.id === runId
        ? { ...item, run: { ...item.run, status: "running", label: decision === "approve" ? `正在执行 ${approval.toolName}…` : "正在继续…", approvals: item.run.approvals.map((a) => a.toolCallId === approval.toolCallId ? { ...a, decision: "approving" } : a) } }
        : item));
    const result = await api.resolveApproval(runId, approval.toolCallId, decision);
    setTimeline((items) => items.map((item) =>
      item.kind === "run" && item.run.id === runId
        ? { ...item, run: { ...item.run, approvals: item.run.approvals.map((a) => a.toolCallId === approval.toolCallId ? { ...a, decision: result.resolved ? (decision === "approve" ? "approved" : "declined") : undefined } : a) } }
        : item));
    await refreshDashboard();
  };

  const resolveStandalone = async (proposal: any, decision: "approve" | "reject") => {
    if (decision === "approve" && !window.confirm(`采纳提案「${proposal.title}」？`)) return;
    let note: string | undefined;
    if (decision === "reject") {
      const reason = await reasonPrompt(`忽略提案「${proposal.title}」的原因（可选）`);
      if (reason === null) return;
      note = reason || undefined;
    }
    const result = await api.resolveProposal(proposal.id, decision, note);
    notify(result.resolved === false ? `应用失败：${result.reason}` : decision === "approve" ? "提案已采纳" : "提案已忽略");
    await loadPending(); await refreshDashboard();
  };

  const onComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // The @-mention popup owns the arrow/enter/tab/escape keys while it is open.
    if (mention && mentionMatches.length > 0) {
      if (event.key === "ArrowDown") { event.preventDefault(); setMention({ ...mention, index: (mention.index + 1) % mentionMatches.length }); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setMention({ ...mention, index: (mention.index - 1 + mentionMatches.length) % mentionMatches.length }); return; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); applyMention(mentionMatches[mention.index]); return; }
      if (event.key === "Escape") { event.preventDefault(); setMention(null); return; }
    }
    // Never intercept while an IME candidate window is open — Enter there commits
    // the Chinese/Japanese selection, it must not send the message.
    if (event.nativeEvent.isComposing || event.key !== "Enter") return;
    if (event.metaKey || event.ctrlKey) {
      // Cmd/Ctrl+Enter → insert a newline at the caret (textareas don't by default).
      event.preventDefault();
      const ta = event.currentTarget;
      const { selectionStart, selectionEnd, value } = ta;
      const next = `${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`;
      setInput(next);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = selectionStart + 1; });
      return;
    }
    if (event.shiftKey) return; // Shift+Enter keeps the default newline.
    event.preventDefault();
    event.currentTarget.form?.requestSubmit(); // Plain Enter sends.
  };

  const submit = (event: FormEvent) => { event.preventDefault(); void send(input); };
  useEffect(() => {
    if (!queuedPrompt) return;
    clearQueuedPrompt();
    void send(queuedPrompt);
  }, [queuedPrompt]);

  return (
    <section className="view">
      <div className="scroll feed" ref={scrollRef}>
        <div className="feed-inner">
          {timeline.length === 0 && (
            <div className="msg-agent">
              <div className="agent-col">
                <div className="agent-text">你好。我可以帮你检索知识、处理变更、归位 inbox，或把对话沉淀成可审阅的提案。</div>
                <div className="chips">
                  {QUICK_PROMPTS.map(([label, prompt]) => <div className="chip" key={label} onClick={() => void send(prompt)}>{label}</div>)}
                </div>
              </div>
            </div>
          )}

          {standalone.map((proposal) => (
            <div className="msg-agent" key={proposal.id}>
              <div className="agent-col">
                <div className="agent-meta">{formatDate(proposal.createdAt)} · 文件监听 / 维护触发</div>
                <ProposalCard proposal={proposal} onApprove={() => void resolveStandalone(proposal, "approve")} onReject={() => void resolveStandalone(proposal, "reject")} onDiff={() => openDiff(proposal)} />
              </div>
            </div>
          ))}

          {timeline.map((item) => item.kind === "user"
            ? <div className="msg-user" key={item.id}><div className="bubble">{item.content}</div></div>
            : <AgentRunBubble key={item.run.id} run={item.run} onResolve={(proposal, decision) => void resolveInlineProposal(item.run.id, proposal, decision)} onApprove={(approval, decision) => void resolveApproval(item.run.id, approval, decision)} onCancel={() => void api.cancelRun(item.run.id)} onOpenSource={openInVault} onOpenDiff={openDiff} />)}
        </div>
      </div>

      <form className="composer" onSubmit={submit}>
        <div className="composer-inner">
          {mention && mentionMatches.length > 0 && (
            <div className="mention-pop">
              {mentionMatches.map((note, index) => (
                <div key={note.path} className={`mention-row ${index === mention.index ? "active" : ""}`}
                  onMouseDown={(event) => { event.preventDefault(); applyMention(note); }}
                  onMouseEnter={() => setMention({ ...mention, index })}>
                  <Icon.file /><span className="name">{note.title}</span><span className="path">{note.path}</span>
                </div>
              ))}
            </div>
          )}
          {mention && mentionMatches.length === 0 && (
            <div className="mention-pop"><div className="mention-empty">没有匹配的笔记</div></div>
          )}
          <textarea ref={inputRef} rows={2} value={input}
            onChange={(event) => { setInput(event.target.value); syncMention(event.target.value, event.target.selectionStart ?? event.target.value.length); }}
            onKeyDown={onComposerKeyDown}
            placeholder="向知识库提问，或让 Apothecary 整理文件…（Enter 发送 · Cmd+Enter 换行）" />
          <div className="composer-bar">
            <span className="composer-pill" title="引用一篇笔记，把它的路径交给 Agent"
              onClick={() => { const ta = inputRef.current; if (!ta) return; ta.focus(); const caret = ta.selectionStart ?? input.length; const next = `${input.slice(0, caret)}@${input.slice(caret)}`; setInput(next); requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = caret + 1; syncMention(next, caret + 1); }); }}>@ 引用笔记</span>
            <span className="spacer" />
            <span className="hint">检索范围：整个 vault</span>
            <button type="submit" className="btn btn-primary sm" disabled={busy}>发送</button>
          </div>
        </div>
      </form>
      {reasonDialog}
    </section>
  );
}

function updateRunProposal(items: TimelineItem[], runId: string, proposalId: string, patch: Partial<RunProposal>): TimelineItem[] {
  return items.map((item) => item.kind === "run" && item.run.id === runId
    ? { ...item, run: { ...item.run, proposals: item.run.proposals.map((proposal) => proposal.proposalId === proposalId ? { ...proposal, ...patch } : proposal) } }
    : item);
}

const runBadge = (status: AgentRun["status"]): [string, string] =>
  status === "running" ? ["warning", "运行中"] : status === "awaiting" ? ["accent", "待确认"] : status === "failed" ? ["danger", "失败"] : ["success", "已完成"];

const TOOL_LABELS: Record<string, string> = { executeIntake: "应用 inbox 整理计划（移动 / 归档）" };

// The agent is instructed to end a vault answer with a `来源：a.md、b.md` line
// listing the files it actually cited. Peel that line off so the body renders as
// clean markdown and the sources become clickable chips.
function splitSources(text: string): { body: string; sources: string[] } {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === "") continue;
    const match = /^\s*来源\s*[：:]\s*(.+)$/.exec(lines[i]);
    if (match) {
      const sources = match[1]
        .split(/[、,，;；]/)
        .map((s) => s.trim().replace(/^[`[「【]+|[`\]」】。.]+$/g, "").trim())
        .filter((s) => /\.[a-z]+$/i.test(s));
      if (sources.length > 0) return { body: lines.slice(0, i).join("\n").trimEnd(), sources };
    }
    break; // Only the last non-empty line can be the citation line.
  }
  return { body: text, sources: [] };
}

function AgentAnswer({ text, onOpenSource }: { text: string; onOpenSource?: (path: string) => void }) {
  const { body, sources } = splitSources(text);
  return (
    <>
      <Markdown className="agent-text" text={body} />
      {sources.length > 0 && (
        <div className="chips">
          {sources.map((source) => (
            <div className="chip" key={source} title={source} onClick={() => onOpenSource?.(source)}>
              <Icon.file /><span>{lastSegment(source)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function AgentRunBubble({ run, onResolve, onApprove, onCancel, onOpenSource, onOpenDiff }: { run: AgentRun; onResolve: (proposal: RunProposal, decision: "approve" | "reject") => void; onApprove: (approval: RunApproval, decision: "approve" | "decline") => void; onCancel: () => void; onOpenSource?: (path: string) => void; onOpenDiff?: (p: any) => void }) {
  const [badgeCls, badgeText] = runBadge(run.status);
  return (
    <div className="msg-agent">
      <div className="agent-col">
        {(run.tools.length > 0 || run.status !== "completed") && (
          <div className="card run-card">
            <div className="run-head">
              <span className={`badge ${badgeCls}`}>{badgeText}</span>
              <span className="t">{run.label}</span>
              <span className="spacer" />
              {run.status === "running" && <button className="btn btn-ghost sm run-cancel-btn" onClick={onCancel} title="取消本次 Agent Run">取消</button>}
            </div>
            {run.tools.length > 0 && (
              <div className="run-steps">
                {run.tools.map((tool) => (
                  <div key={tool.toolCallId} className={`run-step ${tool.status === "completed" ? "done" : tool.status === "failed" ? "failed" : "active"}`}>
                    {tool.status === "running" ? <span className="mini-spin" /> : <span className="ic">{tool.status === "completed" ? "✓" : "!"}</span>}
                    <span className="grow">{tool.toolName}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {run.text && <AgentAnswer text={run.text} onOpenSource={onOpenSource} />}
        {run.proposals.map((proposal) => (
          <div className="card prop-card" key={proposal.proposalId}>
            <div className="prop-head">
              <span className="badge accent">提案 Proposal</span>
              <span className="t">{proposal.title}</span>
              <span className="spacer" />
              <span className="meta">{proposal.type}</span>
            </div>
            <div className="prop-body">
              <ProposalDiffBody proposalId={proposal.proposalId} compact />
              {!proposal.decision && (
                <div className="actions">
                  <button className="btn btn-primary sm" onClick={() => onResolve(proposal, "approve")}>采纳提案</button>
                  <button className="btn btn-secondary sm" onClick={() => onOpenDiff?.({ id: proposal.proposalId, title: proposal.title, type: proposal.type })}>查看完整 diff</button>
                  <button className="btn btn-ghost sm" onClick={() => onResolve(proposal, "reject")}>忽略</button>
                </div>
              )}
              {proposal.decision && (
                <span className={`decision ${proposal.decision === "approving" ? "" : proposal.decision}`}>
                  {proposal.decision === "approving" ? "正在执行…" : proposal.decision === "applied" ? "已采纳并应用" : proposal.decision === "rejected" ? "已忽略" : `执行失败：${proposal.decisionDetail}`}
                </span>
              )}
            </div>
          </div>
        ))}
        {run.approvals.map((approval) => (
          <div className="card prop-card" key={approval.toolCallId}>
            <div className="prop-head">
              <span className="badge warning">需要批准</span>
              <span className="t">执行 {approval.toolName}</span>
              <span className="spacer" />
            </div>
            <div className="prop-body">
              <div className="hint">{TOOL_LABELS[approval.toolName] ?? "Agent 请求执行一个会修改文件的操作。"}</div>
              {!approval.decision && (
                <div className="actions">
                  <button className="btn btn-primary sm" onClick={() => onApprove(approval, "approve")}>批准执行</button>
                  <button className="btn btn-ghost sm" onClick={() => onApprove(approval, "decline")}>拒绝</button>
                </div>
              )}
              {approval.decision && (
                <span className={`decision ${approval.decision === "approving" ? "" : approval.decision === "approved" ? "applied" : "rejected"}`}>
                  {approval.decision === "approving" ? "正在执行…" : approval.decision === "approved" ? "已批准并执行" : "已拒绝"}
                </span>
              )}
            </div>
          </div>
        ))}
        {!run.text && run.tools.length === 0 && run.status !== "failed" && <div className="agent-text muted">正在连接 Agent…</div>}
      </div>
    </div>
  );
}

type ProposalDiffData = { type: string; path?: string; pathChange?: { from: string; to: string }; before?: string; after?: string; note?: string };
type DiffLine = { type: "add" | "del" | "ctx"; text: string };

// LCS line diff. Bounded: for very large notes the O(n·m) table is skipped in
// favour of a whole-block replace, which still reads correctly and stays fast.
function lineDiff(before: string, after: string): DiffLine[] {
  const a = (before ?? "").split("\n");
  const b = (after ?? "").split("\n");
  const n = a.length, m = b.length;
  if (n * m > 400_000) return [...a.map((text) => ({ type: "del" as const, text })), ...b.map((text) => ({ type: "add" as const, text }))];
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: "ctx", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "del", text: a[i] }); i++; }
    else { out.push({ type: "add", text: b[j] }); j++; }
  }
  while (i < n) out.push({ type: "del", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}
const diffSign = (t: DiffLine["type"]) => (t === "add" ? "+ " : t === "del" ? "- " : "  ");

function DiffView({ diff, compact }: { diff: ProposalDiffData; compact?: boolean }) {
  const all = diff.before != null || diff.after != null ? lineDiff(diff.before ?? "", diff.after ?? "") : [];
  // Compact preview: drop unchanged context and cap the number of shown edits.
  const changed = all.filter((l) => l.type !== "ctx");
  const shown = compact ? changed.slice(0, 10) : all;
  const hiddenCount = compact ? changed.length - shown.length : 0;
  return (
    <div className="prop-diff-view">
      {diff.pathChange && (
        <div className="pathchange">
          <span className="from">{diff.pathChange.from}</span>
          <span className="arrow">→</span>
          <span className="to">{diff.pathChange.to}</span>
        </div>
      )}
      {diff.note && <div className="hint" style={{ lineHeight: 1.6 }}>{diff.note}</div>}
      {shown.length > 0 && (
        <div className="diff">
          <div className="hunk">@@ {diff.path ?? diff.type} @@</div>
          <div className="lines">
            {shown.map((line, index) => <div key={index} className={`dl ${line.type}`}>{diffSign(line.type)}{line.text || " "}</div>)}
          </div>
          {hiddenCount > 0 && <div className="hunk">…还有 {hiddenCount} 处变更，点「查看完整 diff」</div>}
        </div>
      )}
    </div>
  );
}

/** Fetch + render a proposal's diff; shared by the inline card and the modal. */
function ProposalDiffBody({ proposalId, compact }: { proposalId: string; compact?: boolean }) {
  const [diff, setDiff] = useState<ProposalDiffData | null>(null);
  useEffect(() => { let alive = true; void api.proposalDiff(proposalId).then((d) => { if (alive) setDiff(d); }).catch(() => undefined); return () => { alive = false; }; }, [proposalId]);
  if (!diff) return <div className="hint">正在载入变更…</div>;
  return <DiffView diff={diff} compact={compact} />;
}

function ProposalCard({ proposal, onApprove, onReject, onDiff }: { proposal: any; onApprove: () => void; onReject: () => void; onDiff: () => void }) {
  return (
    <div className="card prop-card">
      <div className="prop-head">
        <span className="badge accent">提案 Proposal</span>
        <span className="t">{proposal.title}</span>
        <span className="spacer" />
        <span className="meta">{proposal.targetFiles?.length ?? 0} 处变更</span>
      </div>
      <div className="prop-body">
        {proposal.rationale && <div className="hint" style={{ lineHeight: 1.6 }}>{proposal.rationale}</div>}
        <ProposalDiffBody proposalId={proposal.id} compact />
        <div className="actions">
          <button className="btn btn-primary sm" onClick={onApprove}>采纳提案</button>
          <button className="btn btn-secondary sm" onClick={onDiff}>查看完整 diff</button>
          <button className="btn btn-ghost sm" onClick={onReject}>忽略</button>
          <span className="spacer" />
          <span className="hint">采纳后自动应用并更新索引</span>
        </div>
      </div>
    </div>
  );
}

function DiffModal({ proposal, onClose }: { proposal: any; onClose: () => void }) {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="badge accent">提案 Proposal</span>
          <div className="grow">
            <div className="t">{proposal.title}</div>
            <div className="s">{proposal.targetFiles?.join(", ")}</div>
          </div>
          <button className="btn btn-ghost sm icon" title="关闭" onClick={onClose}><Icon.close /></button>
        </div>
        <div className="modal-body">
          {proposal.rationale && <div className="hint" style={{ lineHeight: 1.6 }}>{proposal.rationale}</div>}
          <ProposalDiffBody proposalId={proposal.id} />
        </div>
        <div className="modal-foot">
          <span className="hint">{proposal.type} · {proposal.targetFiles?.length ?? 0} 个目标文件</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn btn-ghost sm" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

/* ═══ Vault ═══════════════════════════════════════════════════════════ */
const scopeLabel = (scope: string) =>
  scope === "inbox" ? "_inbox" : scope === "changes" ? "变更" : scope === "recent" ? "最近" : scope;

/* ── 最近 (recent activity) helpers ──────────────────────────────────── */
// Change-ledger kinds; operation kinds resolve through OP_LABELS at call time.
const CHANGE_LABELS: Record<string, string> = { created: "新增", modified: "修改", deleted: "删除" };
const activityKindLabel = (kind: string) => CHANGE_LABELS[kind] ?? OP_LABELS[kind] ?? kind;
const activityBadgeClass = (item: RecentActivityItem) =>
  item.kind === "created" ? "success" : item.kind === "modified" ? "warning" : item.kind === "deleted" ? "danger" : "accent";
// Deleted files and directory-level ops have nothing to preview.
const activityOpensFile = (item: RecentActivityItem) => item.kind !== "deleted" && item.kind !== "structure";

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

/** Bucket newest-first activity into local-calendar-day groups (今天/昨天/…). */
const groupActivityByDay = (items: RecentActivityItem[]): Array<[string, RecentActivityItem[]]> => {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(new Date());
  const groups: Array<[string, RecentActivityItem[]]> = [];
  for (const item of items) {
    const date = new Date(item.at);
    const diffDays = Math.round((today - startOfDay(date)) / 86_400_000);
    const label = diffDays === 0 ? "今天" : diffDays === 1 ? "昨天" :
      date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
    const last = groups.at(-1);
    if (last && last[0] === label) last[1].push(item);
    else groups.push([label, [item]]);
  }
  return groups;
};

function VaultView({ scope, refreshKey, onChat, notify, target }: { scope: string; refreshKey: number; onChat: (p: string) => void; notify: (t: string) => void; target?: { path: string; nonce: number } | null }) {
  const [files, setFiles] = useState<any[]>([]);
  const [changes, setChanges] = useState<any[]>([]);
  const [activity, setActivity] = useState<RecentActivityItem[]>([]);
  const [selected, setSelected] = useState<{ file: any; data: any } | null>(null);
  const isChanges = scope === "changes";
  const isInbox = scope === "inbox";
  const isRecent = scope === "recent";

  const load = useCallback(() => {
    setSelected(null);
    if (isRecent) { setFiles([]); setChanges([]); void api.recentActivity().then(setActivity).catch((e) => notify(e.message)); }
    else if (isChanges) { setFiles([]); setActivity([]); void api.changes().then(setChanges).catch((e) => notify(e.message)); }
    else { setChanges([]); setActivity([]); const p = isInbox ? api.inbox() : api.vaultFolder(scope); void p.then(setFiles).catch((e) => notify(e.message)); }
  }, [scope, isChanges, isInbox, isRecent, notify]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const openFile = async (file: any, inboxScoped: boolean) => {
    try {
      const data = inboxScoped ? await api.readInbox(file.path) : await api.readFile(file.path);
      setSelected({ file, data });
    } catch (error) { notify((error as Error).message); }
  };

  // A jump request (RAG source chip / in-answer link): open the exact note by
  // path, independent of the current folder listing.
  useEffect(() => {
    if (!target?.path) return;
    const inboxScoped = target.path.replace(/\\/g, "/").startsWith("_inbox/");
    void openFile({ path: target.path }, inboxScoped);
  }, [target?.nonce]);
  const resolveChange = async (id: string, outcome: "processed" | "dismissed") => {
    await api.resolveChanges([id], outcome); notify(outcome === "processed" ? "已标记处理" : "已忽略"); load();
  };

  return (
    <section className="view">
      <div className="split">
        <div className="file-pane">
          <div className="pane-head">
            <span style={{ color: "var(--fg-subtle)" }}>Vault</span><span>/</span>
            <span style={{ color: "var(--fg)", fontWeight: 500 }}>{scopeLabel(scope)}</span>
            <span className="spacer" />
            <span className="mono" style={{ fontSize: 11 }}>{isRecent ? `${activity.length} 项` : isChanges ? `${changes.length} 项` : `${files.length} 项`}</span>
            <button className="btn btn-ghost sm icon" title="手动同步" onClick={async () => { const r = await api.sync(); notify(`同步完成：+${r.created} ~${r.modified} -${r.deleted}`); load(); }}><Icon.refresh /></button>
          </div>
          <div className="file-list">
            {isRecent ? (
              activity.length === 0 ? <Empty>近 7 天没有文件变动。</Empty> : groupActivityByDay(activity).map(([day, items]) => (
                <div key={day}>
                  <div className="file-group-head">{day}</div>
                  {items.map((item) => {
                    const clickable = activityOpensFile(item);
                    return (
                      <div
                        key={item.id}
                        className={`file-row ${selected?.file.path === item.path ? "active" : ""} ${clickable ? "" : "static"}`}
                        onClick={() => clickable && openFile({ path: item.path }, item.path.replace(/\\/g, "/").startsWith("_inbox/"))}
                      >
                        <Icon.file />
                        <div className="info">
                          <div className="name">{lastSegment(item.path)}</div>
                          <div className="sub">
                            {item.actor === "agent" ? "Agent" : "手动"} · {formatTime(item.at)}
                            {item.fromPath && ` · 从 ${item.fromPath}`}
                            {item.detail && ` · ${item.detail}`}
                          </div>
                        </div>
                        <span className={`badge ${activityBadgeClass(item)}`}>{activityKindLabel(item.kind)}</span>
                      </div>
                    );
                  })}
                </div>
              ))
            ) : isChanges ? (
              changes.length === 0 ? <Empty>没有待处理变更，药柜很安静。</Empty> : changes.map((change) => (
                <div key={change.id} className={`file-row ${selected?.file.path === change.path ? "active" : ""}`} onClick={() => change.changeType !== "deleted" && openFile(change, false)}>
                  <Icon.file />
                  <div className="info">
                    <div className="name">{lastSegment(change.path)}</div>
                    <div className="sub">{change.source} · {formatDate(change.detectedAt)}</div>
                  </div>
                  <span className={`badge ${change.changeType === "created" ? "success" : change.changeType === "deleted" ? "danger" : "warning"}`}>{change.changeType}</span>
                </div>
              ))
            ) : (
              files.length === 0 ? <Empty>{isInbox ? "Inbox 已清空。" : "这个文件夹暂时没有 Markdown 文件。"}</Empty> : files.map((file) => (
                <div key={file.path} className={`file-row ${selected?.file.path === file.path ? "active" : ""}`} onClick={() => openFile(file, isInbox)}>
                  <Icon.file />
                  <div className="info">
                    <div className="name">{file.title || lastSegment(file.path)}</div>
                    <div className="sub">{file.mediaType} · {formatDate(file.updatedAt)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="preview-pane">
          {!selected ? (
            <Empty>选择一个文件查看内容</Empty>
          ) : (
            <div className="preview-inner">
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div className="doc-head">
                  <div className="row"><span className="name">{selected.file.title || lastSegment(selected.file.path)}</span></div>
                  <div className="meta">
                    <span>{selected.data.mediaType}</span><span>·</span><span>{selected.data.lineCount} 行</span>
                    {selected.file.path && <><span>·</span><span>{selected.file.path}</span></>}
                  </div>
                </div>
                {(() => {
                  const isMd = /\.md$/i.test(selected.file.path ?? "") || selected.data.mediaType === "markdown";
                  if (!isMd) return <div className="doc-body"><pre>{selected.data.content}</pre></div>;
                  const { frontmatter, body } = splitFrontmatter(selected.data.content);
                  return (
                    <div className="doc-body">
                      {frontmatter && <pre className="frontmatter">{frontmatter}</pre>}
                      <Markdown text={body} />
                    </div>
                  );
                })()}
              </div>
              <div className="actions" style={{ marginTop: 14 }}>
                <button className="btn btn-secondary sm" onClick={() => onChat(`请阅读并为这个文件生成合理的归位提案：${selected.file.path}\n\n内容：\n${selected.data.content.slice(0, 8000)}`)}>让 Agent 建议归位</button>
                {isChanges && (
                  <>
                    <button className="btn btn-ghost sm" onClick={() => void resolveChange(selected.file.id, "processed")}>标记已处理</button>
                    <button className="btn btn-ghost sm" onClick={() => void resolveChange(selected.file.id, "dismissed")}>忽略</button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ═══ Runs ════════════════════════════════════════════════════════════ */
const OP_LABELS: Record<string, string> = {
  edit: "编辑", move: "移动", archive: "归档", merge: "合并", promote: "提升",
  canonical: "规范化", structure: "结构调整", ingest: "归入", capture: "捕获",
};
// Operations whose reverse is well-defined (just move the file back).
const REVERSIBLE_OPS = new Set(["move", "archive"]);
const opLabel = (op: any) => OP_LABELS[op.type] ?? op.type;
// For move/archive the ledger stores [from, to]; the result lives at the last entry.
const opFromTo = (op: any): { from: string; to: string } | null =>
  (op.type === "move" || op.type === "archive") && op.targetFiles?.length >= 2
    ? { from: op.targetFiles[0], to: op.targetFiles[op.targetFiles.length - 1] }
    : null;
const opResultPath = (op: any): string | undefined =>
  (op.type === "move" || op.type === "archive") ? op.targetFiles?.at(-1) : op.targetFiles?.[0];

// 审阅 Review — inspect what the agent actually changed (operation ledger), and
// hand a suspicious change back to the agent to reverse via the proposal/approval
// loop (no direct destructive backend). Complements 变更 (external edits).
function ReviewView({ refreshKey, onChat, notify }: { refreshKey: number; onChat: (p: string) => void; notify: (t: string) => void }) {
  const [ops, setOps] = useState<any[] | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<{ op: any; content?: string } | null>(null);
  const reload = useCallback(() => { setSelected(null); void api.operations().then(setOps).catch(() => setOps([])); }, []);
  useEffect(() => { reload(); }, [reload, refreshKey]);
  const types = useMemo(() => Array.from(new Set((ops ?? []).map((o) => o.type))).filter(Boolean), [ops]);
  const shown = (ops ?? []).filter((o) => filter === "all" || o.type === filter);

  const inspect = async (op: any) => {
    const target = opResultPath(op);
    let content: string | undefined;
    if (target && /\.(md|txt)$/i.test(target)) {
      try { content = (await api.readFile(target)).content; } catch { content = undefined; }
    }
    setSelected({ op, content });
  };
  const handToAgent = (op: any) => {
    const ft = opFromTo(op);
    onChat(ft
      ? `请撤销 Agent 之前的这次「${opLabel(op)}」改动：把 "${ft.to}" 还原回 "${ft.from}"。先说明你将如何操作，再按流程提出提案。`
      : `请复核 Agent 之前的这次「${opLabel(op)}」改动，必要时撤销：${op.targetFiles?.join(", ")}（当时原因：${op.rationale || op.detail || "—"}）`);
  };

  return (
    <section className="view">
      <div className="split">
        <div className="file-pane">
          <div className="pane-head" style={{ flexWrap: "wrap", gap: 6 }}>
            <span className={`badge ${filter === "all" ? "solid" : ""}`} style={{ cursor: "pointer" }} onClick={() => setFilter("all")}>全部 {ops?.length ?? 0}</span>
            {types.map((t) => (
              <span key={t} className={`badge ${filter === t ? "solid" : ""}`} style={{ cursor: "pointer" }} onClick={() => setFilter(t)}>{OP_LABELS[t] ?? t}</span>
            ))}
            <span className="spacer" />
            <button className="btn btn-ghost sm icon" title="刷新" onClick={reload}><Icon.refresh /></button>
          </div>
          <div className="file-list">
            {ops === null ? <Empty>加载中…</Empty> : shown.length === 0 ? <Empty>还没有 Agent 改动记录。Agent 每次真实修改文件都会记录在这里供你审阅。</Empty> : shown.map((op) => {
              const ft = opFromTo(op);
              return (
                <div key={op.id} className={`file-row ${selected?.op.id === op.id ? "active" : ""}`} onClick={() => void inspect(op)}>
                  <span className="badge success" style={{ flex: "none" }}>{opLabel(op)}</span>
                  <div className="info">
                    <div className="name">{ft ? `${lastSegment(ft.from)} → ${lastSegment(ft.to)}` : (op.targetFiles?.map(lastSegment).join(", ") || op.detail || "—")}</div>
                    <div className="sub">{op.source} · {formatDate(op.appliedAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="preview-pane">
          {!selected ? <Empty>选择一条改动，查看 Agent 做了什么</Empty> : (
            <div className="preview-inner">
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div className="doc-head">
                  <div className="row"><span className="badge success">{opLabel(selected.op)}</span><span className="name" style={{ fontSize: 14 }}>{opFromTo(selected.op) ? "文件移动 / 归档" : "文件改动"}</span></div>
                  {opFromTo(selected.op) && (
                    <div className="path-row">
                      <span className="path-old">{opFromTo(selected.op)!.from}</span><span>→</span><span className="path-new">{opFromTo(selected.op)!.to}</span>
                    </div>
                  )}
                  <div className="meta"><span>{selected.op.source}</span><span>·</span><span>{formatDate(selected.op.appliedAt)}</span>{selected.op.id && <><span>·</span><span>{selected.op.id.slice(0, 8)}</span></>}</div>
                  {(selected.op.rationale || selected.op.detail) && <div className="hint" style={{ lineHeight: 1.6 }}>{selected.op.rationale || selected.op.detail}</div>}
                </div>
                {selected.content !== undefined
                  ? <div className="doc-body"><pre>{selected.content}</pre></div>
                  : <div className="doc-body"><p className="muted">目标不是文本文件（或文件已移动/删除），无法预览内容。</p></div>}
              </div>
              <div className="actions" style={{ marginTop: 14 }}>
                <button className="btn btn-secondary sm" onClick={() => handToAgent(selected.op)}>{REVERSIBLE_OPS.has(selected.op.type) ? "让 Agent 撤销这次改动" : "让 Agent 复核"}</button>
                {opResultPath(selected.op) && <span className="hint mono">{opResultPath(selected.op)}</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ═══ Knowledge ═══════════════════════════════════════════════════════ */
type Topic = { label: string; files: string[] };

// A topic is well-covered relative to the biggest domain in the vault.
const coverage = (count: number, max: number): [string, string] => {
  const r = max > 0 ? count / max : 0;
  return r >= 0.66 ? ["success", "覆盖良好"] : r >= 0.33 ? ["accent", "增长中"] : ["warning", "待整理"];
};

function TopicGraph({ topics }: { topics: Topic[] }) {
  const nodes = topics.slice(0, 7);
  if (nodes.length === 0) return null;
  const cx = 450, cy = 95, rx = 300, ry = 62;
  const max = Math.max(...nodes.map((t) => t.files.length), 1);
  const pts = nodes.map((t, i) => {
    const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle), r: 5 + (t.files.length / max) * 6, label: t.label };
  });
  return (
    <div className="graph-wrap">
      <svg width="100%" height="100%" viewBox="0 0 900 190" preserveAspectRatio="xMidYMid slice">
        {pts.map((p, i) => <line key={`l${i}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="var(--border-strong)" strokeWidth={1} />)}
        <circle cx={cx} cy={cy} r={10} fill="var(--primary)" />
        {pts.map((p, i) => <circle key={`c${i}`} cx={p.x} cy={p.y} r={p.r} fill="var(--accent-500)" />)}
        {pts.map((p, i) => (
          <text key={`t${i}`} x={p.x} y={p.y > cy ? p.y + 16 : p.y - 12} textAnchor="middle" fontSize={10.5} fill="var(--fg-muted)">{p.label}</text>
        ))}
      </svg>
    </div>
  );
}

function KnowledgeView({ refreshKey, onChat }: { refreshKey: number; onChat: (p: string) => void }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { void api.knowledge().then(setData).catch(() => setData(null)); }, [refreshKey]);
  const topics: Topic[] = data?.topics ?? [];
  const maxFiles = Math.max(...topics.map((t) => t.files.length), 1);
  const profile = data?.profile;

  return (
    <div className="page">
      <div className="page-inner">
        <div className="kb-head">
          <div className="lead">{data ? `从语义层归纳出 ${topics.length} 个主题域 · ${data.relationCount} 条关系` + (data.profileStale ? " · 画像需刷新" : "") : "加载中…"}</div>
          <span className="spacer" />
          <button className="btn btn-secondary sm" onClick={() => onChat("请基于当前 knowledge profile 和 maintenance findings，告诉我最值得优先整理的三个方向。")}>和 Agent 讨论画像</button>
        </div>

        {!data ? <Empty>加载中…</Empty> : (
          <>
            <div className="metric-row">
              <div className="metric"><strong>{topics.length}</strong><span>主题域</span></div>
              <div className="metric"><strong>{data.relationCount}</strong><span>关系</span></div>
              <div className="metric"><strong>{data.canonicalCandidates.length}</strong><span>Canonical 候选</span></div>
              <div className="metric"><strong>{data.maintenanceFindings.length}</strong><span>维护建议</span></div>
            </div>

            {topics.length > 0 && <TopicGraph topics={topics} />}

            {profile?.overview && (
              <div className="card kb-card">
                <h3>知识画像{data.profileStale ? " · 需要刷新" : ""}</h3>
                <p>{profile.overview}</p>
              </div>
            )}

            {topics.length > 0 && (
              <div className="kb-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                {topics.map((t) => {
                  const [badgeCls, badgeText] = coverage(t.files.length, maxFiles);
                  return (
                    <div className="card interactive kb-card" key={t.label} onClick={() => onChat(`请总结「${t.label}」这个主题域下我已有的笔记，指出重复、空白和值得深入的方向。`)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <h3 style={{ margin: 0, flex: 1 }}>{t.label}</h3>
                        <span className={`badge ${badgeCls}`}>{badgeText}</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                        {t.files.slice(0, 2).map((f) => (
                          <div key={f} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--fg-muted)", overflow: "hidden" }}>
                            <Icon.file /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lastSegment(f)}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 11.5, color: "var(--fg-subtle)" }}>{t.files.length} 篇笔记</div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="kb-grid">
              {profile?.weakAreas?.length > 0 && (
                <div className="card kb-card"><h3>薄弱区域</h3><ul>{profile.weakAreas.slice(0, 5).map((w: string, i: number) => <li key={i}>{w}</li>)}</ul></div>
              )}
              {profile?.recommendations?.length > 0 && (
                <div className="card kb-card"><h3>建议</h3><ul>{profile.recommendations.slice(0, 5).map((r: string, i: number) => <li key={i}>{r}</li>)}</ul></div>
              )}
              <div className="card kb-card wide">
                <h3>维护工作台</h3>
                {data.maintenanceFindings.length === 0 ? <p>当前没有高优先级维护建议。</p> : (
                  <ul>{data.maintenanceFindings.map((f: any, i: number) => <li key={i}><b style={{ color: "var(--fg)" }}>{f.suggestedAction}</b> · {f.detail}</li>)}</ul>
                )}
              </div>
            </div>

            {topics.length === 0 && !profile && (
              <Empty>语义层还没有数据。让 Agent 先扫描并生成一次知识画像与关系图。</Empty>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ═══ Settings ════════════════════════════════════════════════════════ */
function DiagBadge({ diagnostic }: { diagnostic: any }) {
  const ok = diagnostic.status === "connected" || diagnostic.status === "read_write";
  const err = ["auth_error", "unreachable", "unavailable"].includes(diagnostic.status);
  return <span className={`diag-status ${ok ? "ok" : err ? "err" : "warn"}`}><span className="dot" />{diagnostic.detail}</span>;
}

type SettingsForm = { chatModel: string; deepseekBaseUrl: string; embeddingBaseUrl: string; embeddingModel: string; embeddingTimeoutMs: string; watch: boolean; autoIntake: boolean };

function SettingsView({ refreshKey, notify }: { refreshKey: number; notify: (t: string) => void }) {
  const [diag, setDiag] = useState<any>(null);
  const [settings, setSettings] = useState<DesktopSettingsView | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [dkKey, setDkKey] = useState("");
  const [emKey, setEmKey] = useState("");
  const [needsRestart, setNeedsRestart] = useState(false);

  const loadDiag = useCallback(() => api.diagnostics().then(setDiag).catch((e) => notify(e.message)), [notify]);
  const loadSettings = useCallback(() => api.getSettings().then((s) => {
    setSettings(s);
    setForm({
      chatModel: s.chatModel ?? "", deepseekBaseUrl: s.deepseekBaseUrl ?? "", embeddingBaseUrl: s.embeddingBaseUrl ?? "",
      embeddingModel: s.embeddingModel ?? "", embeddingTimeoutMs: s.embeddingTimeoutMs ? String(s.embeddingTimeoutMs) : "",
      watch: s.watch !== false, autoIntake: s.autoIntake === true,
    });
  }).catch((e) => notify(e.message)), [notify]);
  useEffect(() => { void loadDiag(); void loadSettings(); }, [loadDiag, loadSettings, refreshKey]);

  const set = <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    if (!form) return;
    const patch: SaveSettingsPatch = {
      chatModel: form.chatModel.trim() || undefined,
      deepseekBaseUrl: form.deepseekBaseUrl.trim() || undefined,
      embeddingBaseUrl: form.embeddingBaseUrl.trim() || undefined,
      embeddingModel: form.embeddingModel.trim() || undefined,
      embeddingTimeoutMs: form.embeddingTimeoutMs ? Number(form.embeddingTimeoutMs) : undefined,
      watch: form.watch, autoIntake: form.autoIntake,
    };
    if (dkKey) patch.deepseekApiKey = dkKey;
    if (emKey) patch.embeddingApiKey = emKey;
    try {
      const next = await api.saveSettings(patch);
      setSettings(next); setDkKey(""); setEmKey(""); setNeedsRestart(true);
      notify("设置已保存"); void loadDiag();
    } catch (e) { notify((e as Error).message); }
  };

  const changeVault = async () => {
    const picked = await api.chooseVault();
    if (picked) { setSettings((s) => (s ? { ...s, vaultPath: picked } : s)); setNeedsRestart(true); notify("Vault 已更新，重启后生效"); }
  };

  if (!form) return <div className="page"><Empty>加载设置…</Empty></div>;

  return (
    <div className="page">
      <div className="settings-inner">
        {needsRestart && (
          <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, borderColor: "var(--border-strong)" }}>
            <span className="badge accent">需重启</span>
            <span style={{ flex: 1, fontSize: 13 }}>模型 / 密钥 / 地址 / 监听等更改需要重启应用才能完全生效。</span>
            <button className="btn btn-primary sm" onClick={() => void api.relaunchApp()}>立即重启</button>
          </div>
        )}

        <div className="card settings-card">
          <div className="h">连接状态</div>
          {!diag ? <Empty>正在检测连接…</Empty> : (
            <>
              <div className="row-between">
                <div className="grow"><div className="rt">对话与整理模型</div><div className="rd">{diag.model.model ? `${diag.model.model} · ${diag.model.host}` : diag.model.detail}</div></div>
                <DiagBadge diagnostic={diag.model} />
              </div>
              <div className="row-between">
                <div className="grow"><div className="rt">向量 Embedding</div><div className="rd">{diag.embedding.model ? `${diag.embedding.model} · ${diag.embedding.host}` : diag.embedding.detail}</div></div>
                <DiagBadge diagnostic={diag.embedding} />
              </div>
              <div className="row-between">
                <div className="grow"><div className="rt">本地药柜</div><div className="rd mono">{diag.vault.path}</div></div>
                <DiagBadge diagnostic={{ status: diag.vault.status, detail: diag.vault.status === "read_write" ? "可读写" : diag.vault.status === "read_only" ? "只读" : "不可访问" }} />
              </div>
              <div className="actions" style={{ marginTop: 4 }}>
                <button className="btn btn-secondary sm" onClick={() => void loadDiag()}>重新检测</button>
                <span className="spacer" style={{ flex: 1 }} />
                <span className="hint">检测时间：{formatDate(diag.checkedAt)}</span>
              </div>
            </>
          )}
        </div>

        <div className="card settings-card">
          <div className="h">Vault</div>
          <div className="field">
            <label>Vault 路径</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input mono" value={settings?.vaultPath ?? ""} readOnly style={{ fontSize: 12.5 }} />
              <button className="btn btn-secondary sm" style={{ flex: "none" }} onClick={() => void changeVault()}>更换…</button>
            </div>
            <div className="help">Agent 会监听此文件夹的变更、整理 _inbox，并为全部笔记建立索引。</div>
          </div>
          <div className="row-between">
            <div className="grow"><div className="rt">实时监听文件变更</div><div className="rd">关闭后仅在手动同步时扫描</div></div>
            <button className={`switch ${form.watch ? "on" : ""}`} onClick={() => set("watch", !form.watch)}><i /></button>
          </div>
        </div>

        <div className="card settings-card">
          <div className="h">模型与密钥</div>
          <div className="field">
            <label>对话模型</label>
            <input className="input" value={form.chatModel} placeholder="deepseek/deepseek-v4-flash" onChange={(e) => set("chatModel", e.target.value)} />
          </div>
          <div className="field">
            <label>DeepSeek API Key</label>
            <input className="input mono" type="password" value={dkKey} placeholder={settings?.hasDeepseekKey ? "已配置 · 留空保持不变" : "sk-…"} onChange={(e) => setDkKey(e.target.value)} style={{ fontSize: 12.5 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Embedding 模型</label><input className="input" value={form.embeddingModel} placeholder="text-embedding-3-small" onChange={(e) => set("embeddingModel", e.target.value)} /></div>
            <div className="field"><label>Embedding 超时 (ms)</label><input className="input" type="number" value={form.embeddingTimeoutMs} placeholder="20000" onChange={(e) => set("embeddingTimeoutMs", e.target.value)} /></div>
          </div>
          <div className="field">
            <label>Embedding 地址</label>
            <input className="input mono" value={form.embeddingBaseUrl} placeholder="https://api.aihubmix.com/v1" onChange={(e) => set("embeddingBaseUrl", e.target.value)} style={{ fontSize: 12.5 }} />
          </div>
          <div className="field">
            <label>Embedding API Key</label>
            <input className="input mono" type="password" value={emKey} placeholder={settings?.hasEmbeddingKey ? "已配置 · 留空保持不变" : "sk-…"} onChange={(e) => setEmKey(e.target.value)} style={{ fontSize: 12.5 }} />
          </div>
          <div className="help">密钥经 safeStorage（系统 keychain）加密后仅保存在本机，不上传、也不会回传到界面。</div>
        </div>

        <div className="card settings-card">
          <div className="h">自动整理</div>
          <div className="row-between">
            <div className="grow"><div className="rt">自动归位 _inbox</div><div className="rd">新文件落入 _inbox 后自动归档到 PARA 目录，无需逐批审批；低置信度的留在原处，所有移动可在「审阅」里撤销。改动模型/开关后需重启生效。</div></div>
            <button className={`switch ${form.autoIntake ? "on" : ""}`} onClick={() => set("autoIntake", !form.autoIntake)}><i /></button>
          </div>
        </div>

        <div className="actions">
          <button className="btn btn-primary sm" onClick={() => void save()}>保存设置</button>
          <span className="spacer" style={{ flex: 1 }} />
          <span className="hint">Apothecary</span>
        </div>
      </div>
    </div>
  );
}
