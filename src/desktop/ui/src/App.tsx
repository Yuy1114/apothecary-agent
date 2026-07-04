import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";

type View = "chat" | "changes" | "inbox" | "proposals" | "knowledge" | "diagnostics";
type Message = { role: "user" | "assistant"; content: string };
type ProposalStatus = "proposed" | "applied" | "rejected";
type RunTool = { toolCallId: string; toolName: string; status: "running" | "completed" | "failed" };
type RunProposal = ProposalDecisionState & { decision?: "approving" | "applied" | "rejected" | "failed"; decisionDetail?: string };
type AgentRun = {
  id: string;
  text: string;
  status: "running" | "awaiting" | "completed" | "failed";
  label: string;
  tools: RunTool[];
  proposals: RunProposal[];
};
type TimelineItem = { kind: "user"; id: string; content: string } | { kind: "run"; run: AgentRun };

const api = window.apothecary;
const titles: Record<View, [string, string]> = {
  chat: ["UNIFIED AGENT", "和你的知识药柜对话"],
  changes: ["CHANGE AWARENESS", "处理药柜变更"],
  inbox: ["INBOX TRIAGE", "让新知识找到归属"],
  proposals: ["GOVERNANCE", "审阅 Agent 的修改提案"],
  knowledge: ["KNOWLEDGE PROFILE", "看见你的知识体系"],
  diagnostics: ["SYSTEM STATUS", "检查 Apothecary 的连接状态"],
};

const nav: Array<[View, string, string]> = [
  ["chat", "✦", "对话"], ["changes", "↻", "变更"], ["inbox", "⌁", "Inbox"],
  ["proposals", "◇", "提案"], ["knowledge", "⌘", "知识画像"], ["diagnostics", "◎", "系统状态"],
];

const formatDate = (value?: string) => value
  ? new Date(value).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
  : "";

function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

function DataCard({ title, description, pills = [], children }: {
  title: string; description?: string; pills?: Array<{ text: string; className?: string }>; children?: ReactNode;
}) {
  return <article className="data-card"><div className="card-main"><h3>{title}</h3><p>{description}</p>
    {pills.length > 0 && <div className="card-meta">{pills.map((pill, index) => <span key={`${pill.text}-${index}`} className={`pill ${pill.className ?? ""}`}>{pill.text}</span>)}</div>}
    {children}
  </div></article>;
}

export function App() {
  const [view, setView] = useState<View>("chat");
  const [dashboard, setDashboard] = useState<any>(null);
  const [toast, setToast] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [queuedPrompt, setQueuedPrompt] = useState("");

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

  const [eyebrow, title] = titles[view];
  const openChat = (prompt: string) => { setQueuedPrompt(prompt); setView("chat"); };
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">A</div><div><strong>Apothecary</strong><span>Knowledge workspace</span></div></div>
      <nav aria-label="主要导航">{nav.map(([id, icon, label]) => <button key={id} className={`nav-item ${view === id ? "active" : ""}`} onClick={() => setView(id)}>
        <span>{icon}</span>{label}
        {id === "changes" && dashboard?.pendingChanges > 0 && <b className="badge">{dashboard.pendingChanges}</b>}
        {id === "proposals" && dashboard?.pendingProposals > 0 && <b className="badge">{dashboard.pendingProposals}</b>}
      </button>)}</nav>
      <div className="vault-card"><span className="status-dot"/><div><small>当前药柜</small><strong>{dashboard?.vaultPath?.split(/[\\/]/).filter(Boolean).at(-1) ?? "加载中…"}</strong></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div><button className="icon-button" title="刷新当前页面" onClick={refresh}>↻</button></header>
      {view === "chat" && <ChatView dashboard={dashboard} refreshDashboard={refreshDashboard} queuedPrompt={queuedPrompt} clearQueuedPrompt={() => setQueuedPrompt("")}/>} 
      {view === "changes" && <ChangesView refreshKey={refreshKey} onChat={openChat} notify={notify}/>} 
      {view === "inbox" && <InboxView refreshKey={refreshKey} onChat={openChat} notify={notify}/>} 
      {view === "proposals" && <ProposalsView refreshKey={refreshKey} notify={notify}/>} 
      {view === "knowledge" && <KnowledgeView refreshKey={refreshKey} onChat={openChat}/>} 
      {view === "diagnostics" && <DiagnosticsView refreshKey={refreshKey}/>} 
    </main>
    <div className={`toast ${toast ? "show" : ""}`} role="status">{toast}</div>
  </div>;
}

function ChatView({ dashboard, refreshDashboard, queuedPrompt, clearQueuedPrompt }: { dashboard: any; refreshDashboard: () => Promise<void>; queuedPrompt: string; clearQueuedPrompt: () => void }) {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [input, setInput] = useState("");
  const busy = timeline.some((item) => item.kind === "run" && (item.run.status === "running" || item.run.status === "awaiting"));

  useEffect(() => api.onRunEvent(({ runId, event }) => {
    setTimeline((items) => items.map((item) => {
      if (item.kind !== "run" || item.run.id !== runId) return item;
      const run = item.run;
      if (event.type === "text_delta") return { ...item, run: { ...run, text: run.text + event.text } };
      if (event.type === "status") return { ...item, run: { ...run, label: event.label } };
      if (event.type === "tool_started") return { ...item, run: { ...run, label: `正在使用 ${event.toolName}`, tools: [...run.tools, { toolCallId: event.toolCallId, toolName: event.toolName, status: "running" }] } };
      if (event.type === "tool_completed") return { ...item, run: { ...run, tools: run.tools.map((tool) => tool.toolCallId === event.toolCallId ? { ...tool, status: event.failed ? "failed" : "completed" } : tool) } };
      if (event.type === "awaiting_decision") return { ...item, run: { ...run, status: "awaiting", label: "等待你确认提案", proposals: [...run.proposals, event.proposal] } };
      if (event.type === "completed") return { ...item, run: { ...run, status: "completed", label: run.proposals.some((proposal) => !proposal.decision) ? "等待你的决定" : "Agent Run 已完成" } };
      if (event.type === "failed") return { ...item, run: { ...run, status: "failed", label: event.message } };
      return item;
    }));
    if (event.type === "completed" || event.type === "failed") void refreshDashboard();
  }), [refreshDashboard]);

  const conversationFrom = (items: TimelineItem[]): Message[] => items.reduce<Message[]>((messages, item) => {
    if (item.kind === "user") messages.push({ role: "user", content: item.content });
    else if (item.run.text) messages.push({ role: "assistant", content: item.run.text });
    return messages;
  }, []).slice(-19);

  const send = async (text: string, visible = true) => {
    const content = text.trim(); if (!content || busy) return;
    const runId = crypto.randomUUID();
    const userItem: TimelineItem = { kind: "user", id: crypto.randomUUID(), content };
    const runItem: TimelineItem = { kind: "run", run: { id: runId, text: "", status: "running", label: "正在启动 Agent Run", tools: [], proposals: [] } };
    const next = visible ? [...timeline, userItem, runItem] : [...timeline, runItem];
    setTimeline(next); setInput("");
    try {
      await api.startRun(runId, [...conversationFrom(timeline), { role: "user", content }]);
    } catch (error) {
      setTimeline((items) => items.map((item) => item.kind === "run" && item.run.id === runId ? { ...item, run: { ...item.run, status: "failed", label: (error as Error).message } } : item));
    }
  };

  const resolveInlineProposal = async (runId: string, proposal: RunProposal, decision: "approve" | "reject") => {
    if (decision === "approve" && !window.confirm(`批准提案「${proposal.title}」并应用？`)) return;
    const note = decision === "reject" ? window.prompt("拒绝原因（可选）") || undefined : undefined;
    // Mark the proposal in-flight and hand the run back to the agent. resumeRun
    // applies the decision (approve => file change) and resumes the suspended run;
    // its continuation streams onto this same timeline bubble via onRunEvent.
    setTimeline((items) => items.map((item) =>
      item.kind === "run" && item.run.id === runId
        ? { ...item, run: { ...item.run, status: "running", label: decision === "approve" ? "正在应用并继续…" : "正在继续…", proposals: item.run.proposals.map((existing) => existing.proposalId === proposal.proposalId ? { ...existing, decision: "approving" } : existing) } }
        : item));
    const result = await api.resumeRun(runId, proposal.proposalId, decision, note);
    const finalDecision = !result.resolved ? "failed" : decision === "approve" ? "applied" : "rejected";
    setTimeline((items) => updateRunProposal(items, runId, proposal.proposalId, { decision: finalDecision, decisionDetail: result.reason }));
    await refreshDashboard();
  };

  const cancelRun = async (runId: string) => { await api.cancelRun(runId); };

  const submit = (event: FormEvent) => { event.preventDefault(); void send(input); };
  useEffect(() => {
    if (!queuedPrompt) return;
    clearQueuedPrompt();
    void send(queuedPrompt);
  }, [queuedPrompt]);
  return <section className="view active" id="view-chat"><div className="chat-layout">
    <div className="chat-messages"><MessageBubble role="assistant" content="你好。我可以帮你检索知识、处理变更、归位 inbox，或把对话沉淀成可审阅的提案。"/>
      {timeline.map((item) => item.kind === "user"
        ? <MessageBubble key={item.id} role="user" content={item.content}/>
        : <AgentRunBubble key={item.run.id} run={item.run} onResolve={(proposal, decision) => void resolveInlineProposal(item.run.id, proposal, decision)} onCancel={() => void cancelRun(item.run.id)}/>)}
    </div>
    <form className="composer" onSubmit={submit}><textarea rows={3} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="问一个问题，或告诉我想添加、整理什么内容…"/>
      <div className="composer-footer"><span>所有真实文件修改都需要提案确认</span><button type="submit" className="primary" disabled={busy}>发送 <span>⌘↵</span></button></div></form>
  </div><aside className="context-panel"><h3>现在可以做什么</h3>
    {["有哪些文件发生了变更？请帮我判断应该如何处理。", "请扫描 inbox，并建议这些文件应该归位到哪里。", "根据当前药柜，总结我的核心知识主题和薄弱区域。"].map((prompt, index) => <button className="prompt-chip" key={prompt} onClick={() => void send(prompt)}>{["检查最近变更", "整理 Inbox", "查看知识画像"][index]}</button>)}
    <div className="divider"/><h3>最近活动</h3><div className="mini-list">{dashboard?.recentOperations?.length ? dashboard.recentOperations.slice(0, 5).map((op: any) => <div className="mini-item" key={op.id}>{op.type} · {op.targetFiles.join(", ")}</div>) : <p className="muted">暂无活动</p>}</div>
  </aside></section>;
}

function updateRunProposal(items: TimelineItem[], runId: string, proposalId: string, patch: Partial<RunProposal>): TimelineItem[] {
  return items.map((item) => item.kind === "run" && item.run.id === runId
    ? { ...item, run: { ...item.run, proposals: item.run.proposals.map((proposal) => proposal.proposalId === proposalId ? { ...proposal, ...patch } : proposal) } }
    : item);
}

function AgentRunBubble({ run, onResolve, onCancel }: { run: AgentRun; onResolve: (proposal: RunProposal, decision: "approve" | "reject") => void; onCancel: () => void }) {
  return <div className={`message assistant run-message ${run.status === "running" ? "pending" : ""}`}><div className="avatar">A</div><div className="bubble run-bubble"><strong>APOTHECARY · {run.label}
    {run.status === "running" && <button className="run-cancel" onClick={onCancel} title="取消本次 Agent Run">取消</button>}</strong>
    {run.tools.length > 0 && <div className="run-tools">{run.tools.map((tool) => <div key={tool.toolCallId} className={`run-tool ${tool.status}`}><span>{tool.status === "running" ? "◌" : tool.status === "completed" ? "✓" : "!"}</span><span>{tool.toolName}</span></div>)}</div>}
    {run.text && <p>{run.text}</p>}
    {run.proposals.map((proposal) => <div className="run-proposal" key={proposal.proposalId}><div><b>{proposal.title}</b><span>{proposal.type} · {proposal.targetFiles?.join(", ") || "待执行时确定"}</span></div>
      {!proposal.decision && <div className="card-actions"><button className="primary" onClick={() => onResolve(proposal, "approve")}>批准并应用</button><button className="danger" onClick={() => onResolve(proposal, "reject")}>拒绝</button></div>}
      {proposal.decision && <span className={`run-decision ${proposal.decision}`}>{proposal.decision === "approving" ? "正在执行…" : proposal.decision === "applied" ? "已批准并应用" : proposal.decision === "rejected" ? "已拒绝" : `执行失败：${proposal.decisionDetail}`}</span>}
    </div>)}
    {!run.text && run.tools.length === 0 && <p>{run.status === "failed" ? run.label : "正在连接 Agent…"}</p>}
  </div></div>;
}

function MessageBubble({ role, content, pending = false }: Message & { pending?: boolean }) {
  return <div className={`message ${role} ${pending ? "pending" : ""}`}><div className="avatar">{role === "user" ? "Y" : "A"}</div><div className="bubble"><strong>{role === "user" ? "YOU" : "APOTHECARY"}</strong><p>{content}</p></div></div>;
}

function ChangesView({ refreshKey, onChat, notify }: { refreshKey: number; onChat: (prompt: string) => void; notify: (text: string) => void }) {
  const [changes, setChanges] = useState<any[]>([]); const [open, setOpen] = useState<Record<string, string>>({});
  const load = useCallback(() => api.changes().then(setChanges), []);
  useEffect(() => { void load(); }, [load, refreshKey]);
  const resolve = async (id: string, outcome: "processed" | "dismissed") => { await api.resolveChanges([id], outcome); notify(outcome === "processed" ? "已标记处理" : "已忽略"); await load(); };
  return <section className="view active"><div className="section-toolbar"><div><h2>待处理变更</h2><p>由 watcher、manual sync 或恢复队列记录</p></div><button className="secondary" onClick={async () => { const result = await api.sync(); notify(`同步完成：+${result.created} ~${result.modified} -${result.deleted}`); await load(); }}>运行 Manual Sync</button></div>
    <div className="card-list">{changes.length === 0 ? <Empty>没有待处理变更，药柜很安静。</Empty> : changes.map((change) => <DataCard key={change.id} title={change.path} description={`${change.source} · ${formatDate(change.detectedAt)}`} pills={[{ text: change.changeType, className: change.changeType }]}><div className="card-actions">
      {change.changeType !== "deleted" && <button className="ghost" onClick={async () => setOpen({ ...open, [change.id]: (await api.readFile(change.path)).content })}>查看</button>}
      <button className="secondary" onClick={() => onChat(`请分析这个变更并建议如何处理：${change.path}（${change.changeType}）`)}>交给 Agent</button><button className="ghost" onClick={() => void resolve(change.id, "processed")}>已处理</button><button className="ghost" onClick={() => void resolve(change.id, "dismissed")}>忽略</button>
    </div>{open[change.id] && <details className="inline-detail" open><summary>当前文件内容</summary><pre>{open[change.id]}</pre></details>}</DataCard>)}</div>
  </section>;
}

function InboxView({ refreshKey, onChat, notify }: { refreshKey: number; onChat: (prompt: string) => void; notify: (text: string) => void }) {
  const [files, setFiles] = useState<any[]>([]); const [selected, setSelected] = useState<any>(null);
  useEffect(() => { void api.inbox().then(setFiles).catch((error) => notify(error.message)); }, [notify, refreshKey]);
  return <section className="view active inbox-view"><div className="section-toolbar"><div><h2>Inbox</h2><p>理解内容后，再生成归位提案</p></div><button className="secondary" onClick={() => onChat(`请扫描并分析 inbox 中的这些文件，为每个文件提出归位建议：${files.map((file) => file.path).join(", ")}`)}>让 Agent 分析全部</button></div><div className="split-view"><div className="card-list compact">{files.length === 0 ? <Empty>Inbox 已清空。</Empty> : files.map((file) => <div key={file.path} onClick={async () => setSelected({ file, data: await api.readInbox(file.path) })}><DataCard title={file.title || file.path.split("/").at(-1)} description={file.path} pills={[{ text: file.mediaType }, { text: formatDate(file.updatedAt) }]}/></div>)}</div>
    <div className="detail-panel">{!selected ? <Empty>选择一个文件查看内容</Empty> : <><h2>{selected.file.title || selected.file.path}</h2><p className="muted">{selected.data.mediaType} · {selected.data.lineCount} 行</p><button className="secondary" onClick={() => onChat(`请阅读并为这个 inbox 文件生成合理的归位提案：${selected.file.path}\n\n内容：\n${selected.data.content.slice(0, 8000)}`)}>让 Agent 建议归位</button><pre>{selected.data.content}</pre></>}</div></div></section>;
}

function ProposalsView({ refreshKey, notify }: { refreshKey: number; notify: (text: string) => void }) {
  const [status, setStatus] = useState<ProposalStatus>("proposed"); const [items, setItems] = useState<any[]>([]);
  const load = useCallback(() => api.proposals(status).then(setItems), [status]); useEffect(() => { void load(); }, [load, refreshKey]);
  const resolve = async (proposal: any, decision: "approve" | "reject") => { if (decision === "approve" && !window.confirm(`批准提案「${proposal.title}」？`)) return; const note = decision === "reject" ? window.prompt("拒绝原因（可选）") || undefined : undefined; const result = await api.resolveProposal(proposal.id, decision, note); notify(result.resolved === false ? `应用失败：${result.reason}` : decision === "approve" ? "提案已应用" : "提案已拒绝"); await load(); };
  return <section className="view active"><div className="section-toolbar"><div><h2>变更提案</h2><p>所有 human-readable layer 修改的统一确认入口</p></div><div className="segmented">{(["proposed", "applied", "rejected"] as ProposalStatus[]).map((value) => <button key={value} className={status === value ? "active" : ""} onClick={() => setStatus(value)}>{({ proposed: "待确认", applied: "已应用", rejected: "已拒绝" })[value]}</button>)}</div></div><div className="card-list">{items.length === 0 ? <Empty>这个列表是空的。</Empty> : items.map((proposal) => <DataCard key={proposal.id} title={proposal.title} description={proposal.rationale} pills={[{ text: proposal.type }, { text: proposal.status }, { text: formatDate(proposal.createdAt) }, ...proposal.targetFiles.map((file: string) => ({ text: file }))]}>{proposal.status === "proposed" && <div className="card-actions"><button className="primary" onClick={() => void resolve(proposal, "approve")}>批准</button><button className="danger" onClick={() => void resolve(proposal, "reject")}>拒绝</button></div>}<details className="inline-detail"><summary>查看 proposal payload</summary><pre>{JSON.stringify(proposal.payload, null, 2)}</pre></details></DataCard>)}</div></section>;
}

function KnowledgeView({ refreshKey, onChat }: { refreshKey: number; onChat: (prompt: string) => void }) {
  const [data, setData] = useState<any>(null); useEffect(() => { void api.knowledge().then(setData); }, [refreshKey]);
  return <section className="view active"><div className="section-toolbar"><div><h2>知识画像</h2><p>药柜当前主题、关系与维护机会</p></div><button className="secondary" onClick={() => onChat("请基于当前 knowledge profile 和 maintenance findings，告诉我最值得优先整理的三个方向。")}>和 Agent 讨论画像</button></div>{!data ? <Empty>加载中…</Empty> : <div className="knowledge-grid"><section className="knowledge-card"><h3>语义层状态</h3><div className="metric-row">{[[data.relationCount, "关系"], [data.canonicalCandidates.length, "Canonical candidates"], [data.maintenanceFindings.length, "维护建议"]].map(([value, label]) => <div className="metric" key={label}><strong>{value}</strong><span>{label}</span></div>)}</div></section><section className="knowledge-card"><h3>知识画像{data.profileStale ? " · 需要刷新" : ""}</h3><p>{data.profile?.overview || "尚未生成 knowledge profile。"}</p></section><section className="knowledge-card wide"><h3>维护工作台</h3>{data.maintenanceFindings.length === 0 ? <p>当前没有高优先级维护建议。</p> : <ul>{data.maintenanceFindings.map((finding: any, index: number) => <li key={index}>{finding.suggestedAction} · {finding.detail}</li>)}</ul>}</section></div>}</section>;
}

function DiagnosticsView({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<any>(null); const load = useCallback(() => api.diagnostics().then(setData), []); useEffect(() => { void load(); }, [load, refreshKey]);
  const card = (title: string, diagnostic: any) => <section className={`diagnostic-card status-${diagnostic.status}`}><div className="diagnostic-header"><h3>{title}</h3><span className="diagnostic-status">{diagnostic.detail}</span></div><p>{diagnostic.model ? `${diagnostic.model} · ${diagnostic.host}` : diagnostic.path}</p></section>;
  return <section className="view active"><div className="section-toolbar"><div><h2>系统状态</h2><p>验证模型、Embedding 与本地药柜是否可用</p></div><button className="secondary" onClick={() => void load()}>重新检测</button></div>{!data ? <Empty>正在检测连接…</Empty> : <div className="diagnostics-grid">{card("对话模型", data.model)}{card("向量 Embedding", data.embedding)}{card("本地药柜", { status: data.vault.status === "read_write" ? "connected" : "unreachable", detail: data.vault.status === "read_write" ? "可读写" : "不可访问", path: data.vault.path })}<p className="diagnostic-time">检测时间：{formatDate(data.checkedAt)}</p></div>}</section>;
}
