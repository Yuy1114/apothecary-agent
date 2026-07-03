const api = window.apothecary;
const state = { view: "chat", messages: [], proposalStatus: "proposed", inbox: [], chatBusy: false };
const titles = {
  chat: ["UNIFIED AGENT", "和你的知识药柜对话"],
  changes: ["CHANGE AWARENESS", "处理药柜变更"],
  inbox: ["INBOX TRIAGE", "让新知识找到归属"],
  proposals: ["GOVERNANCE", "审阅 Agent 的修改提案"],
  knowledge: ["KNOWLEDGE PROFILE", "看见你的知识体系"],
};

const $ = (selector) => document.querySelector(selector);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const formatDate = (value) => value ? new Date(value).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const empty = (text) => { const node = el("div", "empty-state", text); return node; };
function toast(message) { const node = $("#toast"); node.textContent = message; node.classList.add("show"); setTimeout(() => node.classList.remove("show"), 2200); }
function setLoading(loading) { document.body.classList.toggle("loading", loading); }

async function loadDashboard() {
  const data = await api.dashboard();
  $("#vault-name").textContent = data.vaultPath.split(/[\\/]/).filter(Boolean).at(-1) || data.vaultPath;
  setBadge("#changes-badge", data.pendingChanges);
  setBadge("#proposals-badge", data.pendingProposals);
  const recent = $("#recent-operations"); recent.replaceChildren();
  if (!data.recentOperations.length) recent.append(empty("暂无活动"));
  data.recentOperations.slice(0, 5).forEach((op) => recent.append(el("div", "mini-item", `${op.type} · ${op.targetFiles.join(", ")}`)));
}
function setBadge(selector, count) { const node = $(selector); node.textContent = String(count); node.classList.toggle("hidden", count === 0); }

async function navigate(view) {
  state.view = view;
  document.querySelectorAll(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("active", node.id === `view-${view}`));
  $("#view-eyebrow").textContent = titles[view][0]; $("#view-title").textContent = titles[view][1];
  await refreshView();
}

async function refreshView() {
  setLoading(true);
  try {
    if (state.view === "changes") await loadChanges();
    if (state.view === "inbox") await loadInbox();
    if (state.view === "proposals") await loadProposals();
    if (state.view === "knowledge") await loadKnowledge();
    await loadDashboard();
  } catch (error) { toast(`加载失败：${error.message}`); }
  finally { setLoading(false); }
}

function appendMessage(role, content) {
  state.messages.push({ role, content });
  const row = el("div", `message ${role}`); row.append(el("div", "avatar", role === "user" ? "Y" : "A"));
  const bubble = el("div", "bubble"); bubble.append(el("strong", "", role === "user" ? "YOU" : "APOTHECARY"), el("p", "", content)); row.append(bubble);
  $("#chat-messages").append(row); $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
}
function appendPending() {
  const row = el("div", "message assistant pending"); row.append(el("div", "avatar", "A"));
  const bubble = el("div", "bubble"); const p = el("p", "", "正在检索并思考…"); bubble.append(el("strong", "", "APOTHECARY"), p); row.append(bubble);
  $("#chat-messages").append(row); $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
  return { row, setText: (text) => { p.textContent = text; row.classList.remove("pending"); } };
}
async function sendChat(text) {
  // Chat is a long, multi-step agent turn — keep it LOCAL to the chat panel so
  // the rest of the app stays usable (no global freeze), and guard re-entry.
  if (!text.trim() || state.chatBusy) return;
  state.chatBusy = true;
  appendMessage("user", text.trim()); $("#chat-input").value = "";
  const pending = appendPending(); const sendButton = $("#chat-form button[type=submit]");
  if (sendButton) sendButton.disabled = true;
  try {
    const reply = await api.chat(state.messages);
    pending.setText(reply); state.messages.push({ role: "assistant", content: reply });
    await loadDashboard();
  } catch (error) {
    pending.setText(`暂时无法完成：${error.message}`); pending.row.classList.add("error");
  } finally {
    state.chatBusy = false; if (sendButton) sendButton.disabled = false;
  }
}

function dataCard({ title, description, pills = [], actions = [] }) {
  const card = el("article", "data-card"); const main = el("div", "card-main"); main.append(el("h3", "", title), el("p", "", description || ""));
  if (pills.length) { const meta = el("div", "card-meta"); pills.forEach((pill) => meta.append(el("span", `pill ${pill.className || ""}`, pill.text))); main.append(meta); }
  card.append(main);
  if (actions.length) { const area = el("div", "card-actions"); actions.forEach((action) => { const button = el("button", action.className || "ghost", action.label); button.addEventListener("click", action.onClick); area.append(button); }); card.append(area); }
  return card;
}

async function loadChanges() {
  const list = $("#changes-list"); list.replaceChildren(); const changes = await api.changes();
  if (!changes.length) return list.append(empty("没有待处理变更，药柜很安静。"));
  changes.forEach((change) => { const card = dataCard({ title: change.path, description: `${change.source} · ${formatDate(change.detectedAt)}`, pills: [{ text: change.changeType, className: change.changeType }], actions: [
    ...(change.changeType === "deleted" ? [] : [{
      label: "查看",
      onClick: async () => {
        try {
          const data = await api.readFile(change.path);
          let detail = card.querySelector(".inline-detail");
          if (!detail) {
            detail = el("details", "inline-detail");
            detail.append(el("summary", "", "当前文件内容"), el("pre", "", data.content));
            card.querySelector(".card-main").append(detail);
          }
          detail.open = true;
        } catch (error) { toast(`无法读取：${error.message}`); }
      },
    }]),
    { label: "交给 Agent", className: "secondary", onClick: () => { navigate("chat"); sendChat(`请分析这个变更并建议如何处理：${change.path}（${change.changeType}）`); } },
    { label: "已处理", onClick: async () => { await api.resolveChanges([change.id], "processed"); toast("已标记处理"); refreshView(); } },
    { label: "忽略", onClick: async () => { await api.resolveChanges([change.id], "dismissed"); toast("已忽略"); refreshView(); } },
  ] }); list.append(card); });
}

async function loadInbox() {
  const list = $("#inbox-list"); list.replaceChildren(); state.inbox = await api.inbox();
  if (!state.inbox.length) return list.append(empty("Inbox 已清空。"));
  state.inbox.forEach((file) => { const card = dataCard({ title: file.title || file.path.split("/").at(-1), description: file.path, pills: [{ text: file.mediaType }, { text: formatDate(file.updatedAt) }] }); card.addEventListener("click", () => showInboxFile(file)); list.append(card); });
}
async function showInboxFile(file) {
  const detail = $("#inbox-detail"); detail.replaceChildren(el("p", "muted", "读取中…"));
  try { const data = await api.readInbox(file.path); const title = el("h2", "", file.title || file.path); const ask = el("button", "secondary", "让 Agent 建议归位"); ask.addEventListener("click", () => { navigate("chat"); sendChat(`请阅读并为这个 inbox 文件生成合理的归位提案：${file.path}\n\n内容：\n${data.content.slice(0, 8000)}`); }); detail.replaceChildren(title, el("p", "muted", `${data.mediaType} · ${data.lineCount} 行`), ask, el("pre", "", data.content)); }
  catch (error) { detail.replaceChildren(empty(error.message)); }
}

async function loadProposals() {
  const list = $("#proposals-list"); list.replaceChildren(); const proposals = await api.proposals(state.proposalStatus);
  if (!proposals.length) return list.append(empty("这个列表是空的。"));
  proposals.forEach((proposal) => {
    const actions = proposal.status === "proposed" ? [
      { label: "批准", className: "primary", onClick: async () => { if (!confirm(`批准提案「${proposal.title}」？\n\n影响：${proposal.targetFiles.join(", ") || "由执行器决定"}`)) return; const result = await api.resolveProposal(proposal.id, "approve"); toast(result.resolved ? "提案已应用" : `应用失败：${result.reason}`); refreshView(); } },
      { label: "拒绝", className: "danger", onClick: async () => { const note = prompt("拒绝原因（可选）") || undefined; await api.resolveProposal(proposal.id, "reject", note); toast("提案已拒绝"); refreshView(); } },
    ] : [];
    const card = dataCard({ title: proposal.title, description: proposal.rationale, pills: [{ text: proposal.type }, { text: proposal.status }, { text: formatDate(proposal.createdAt) }, ...proposal.targetFiles.map((path) => ({ text: path }))], actions });
    const detail = el("details", "inline-detail"); detail.append(el("summary", "", "查看 proposal payload"), el("pre", "", JSON.stringify(proposal.payload, null, 2))); card.querySelector(".card-main").append(detail); list.append(card);
  });
}

async function loadKnowledge() {
  const root = $("#knowledge-content"); root.replaceChildren(); const data = await api.knowledge();
  const metrics = el("section", "knowledge-card"); metrics.append(el("h3", "", "语义层状态")); const row = el("div", "metric-row");
  [[data.relationCount, "关系"], [data.canonicalCandidates.length, "Canonical candidates"], [data.maintenanceFindings.length, "维护建议"]].forEach(([value, label]) => { const box = el("div", "metric"); box.append(el("strong", "", String(value)), el("span", "", label)); row.append(box); }); metrics.append(row); root.append(metrics);
  const profile = el("section", "knowledge-card"); profile.append(el("h3", "", `知识画像${data.profileStale ? " · 需要刷新" : ""}`), el("p", "", data.profile?.overview || "尚未生成 knowledge profile。请在 Agent 中请求生成或运行 refresh-profile workflow。")); root.append(profile);
  const findings = el("section", "knowledge-card wide"); findings.append(el("h3", "", "维护工作台"));
  if (!data.maintenanceFindings.length) findings.append(el("p", "", "当前没有高优先级维护建议。"));
  else { const ul = el("ul"); data.maintenanceFindings.forEach((finding) => ul.append(el("li", "", `${finding.suggestedAction} · ${finding.detail}`))); findings.append(ul); } root.append(findings);
}

document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
document.querySelectorAll(".prompt-chip").forEach((button) => button.addEventListener("click", () => sendChat(button.dataset.prompt)));
$("#chat-form").addEventListener("submit", (event) => { event.preventDefault(); sendChat($("#chat-input").value); });
$("#chat-input").addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); $("#chat-form").requestSubmit(); } });
$("#refresh-button").addEventListener("click", refreshView);
$("#sync-button").addEventListener("click", async () => { setLoading(true); try { const result = await api.sync(); toast(`同步完成：+${result.created} ~${result.modified} -${result.deleted}`); await refreshView(); } finally { setLoading(false); } });
$("#triage-all-button").addEventListener("click", () => { navigate("chat"); sendChat(`请扫描并分析 inbox 中的这些文件，为每个文件提出归位建议：${state.inbox.map((file) => file.path).join(", ")}`); });
$("#knowledge-chat-button").addEventListener("click", () => { navigate("chat"); sendChat("请基于当前 knowledge profile 和 maintenance findings，告诉我最值得优先整理的三个方向。"); });
$("#proposal-filter").addEventListener("click", (event) => { const button = event.target.closest("button[data-status]"); if (!button) return; state.proposalStatus = button.dataset.status; document.querySelectorAll("#proposal-filter button").forEach((node) => node.classList.toggle("active", node === button)); loadProposals(); });

loadDashboard().catch((error) => toast(error.message));

// The watcher updates the ledger in the background; poll so the badges (and the
// changes list, when open) reflect external edits without needing to navigate.
// Skipped while an action is in flight to avoid stacking on top of it.
setInterval(async () => {
  if (document.body.classList.contains("loading")) return;
  try {
    await loadDashboard();
    if (state.view === "changes") await loadChanges();
  } catch {
    /* transient read error — the next tick will retry */
  }
}, 4000);
