const state = {
  selectedPath: null,
  savedContent: '',
  draftContent: '',
  activities: [],
  threadId: 'web-chat',
  conversationMessages: [],
  memoryCandidates: [],
  threadSummary: null,
  syncStatus: null,
  syncJobs: [],
};

const el = {
  vaultRoot: document.querySelector('#vault-root'),
  treePanel: document.querySelector('#tree-panel'),
  refreshTree: document.querySelector('#refresh-tree'),
  selectedPath: document.querySelector('#selected-path'),
  updatedAt: document.querySelector('#updated-at'),
  editor: document.querySelector('#markdown-editor'),
  saveFile: document.querySelector('#save-file'),
  saveState: document.querySelector('#save-state'),
  chatForm: document.querySelector('#chat-form'),
  question: document.querySelector('#question'),
  answer: document.querySelector('#answer'),
  conversationFeed: document.querySelector('#conversation-feed'),
  sources: document.querySelector('#sources'),
  reindex: document.querySelector('#reindex'),
  refreshMemory: document.querySelector('#refresh-memory'),
  memoryCandidates: document.querySelector('#memory-candidates'),
  threadSummary: document.querySelector('#thread-summary'),
  activityFeed: document.querySelector('#activity-feed'),
  jobs: document.querySelector('#jobs'),
  syncStatus: document.querySelector('#sync-status'),
  syncJobs: document.querySelector('#sync-jobs'),
  toast: document.querySelector('#toast'),
};

boot().catch((error) => showToast(error.message, true));

async function boot() {
  bindTabs();
  bindEditor();
  bindChat();
  bindMemory();
  bindEvents();
  await Promise.all([loadHealth(), loadTree(), loadActivity(), loadJobs(), loadSync(), loadConversation(), loadMemoryCandidates()]);
}

function bindTabs() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      for (const item of document.querySelectorAll('.tab')) item.classList.remove('selected');
      for (const panel of document.querySelectorAll('.panel')) panel.classList.remove('active');
      tab.classList.add('selected');
      document.querySelector(`#panel-${tab.dataset.panel}`).classList.add('active');
    });
  }
}

function bindEditor() {
  el.refreshTree.addEventListener('click', loadTree);
  el.saveFile.addEventListener('click', saveFile);
  el.editor.addEventListener('input', () => {
    state.draftContent = el.editor.value;
    renderSaveState();
  });
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void saveFile();
    }
  });
}

function bindChat() {
  el.chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = el.question.value.trim();
    if (!query) return;
    el.answer.textContent = '检索和组织回答中…';
    el.answer.classList.remove('empty-state');
    el.sources.textContent = '检索中…';
    try {
      const result = await requestJson('/api/rag/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, topK: 5, threadId: state.threadId }),
      });
      el.answer.textContent = result.answer || '没有生成回答。';
      el.question.value = '';
      renderSources(result.sources ?? []);
      await Promise.all([loadConversation(), loadMemoryCandidates(), loadActivity()]);
    } catch (error) {
      el.answer.textContent = getErrorMessage(error);
      el.sources.textContent = '失败';
    }
  });

  el.reindex.addEventListener('click', async () => {
    el.reindex.disabled = true;
    el.reindex.textContent = 'Indexing…';
    try {
      const result = await requestJson('/api/index', { method: 'POST' });
      showToast(`已排队重建索引：sync job ${result.syncJob.id}`);
      await Promise.all([loadActivity(), loadSync()]);
    } catch (error) {
      showToast(getErrorMessage(error), true);
    } finally {
      el.reindex.disabled = false;
      el.reindex.textContent = 'Reindex Vault';
    }
  });
}

function bindMemory() {
  el.refreshMemory.addEventListener('click', async () => {
    await Promise.all([loadConversation(), loadMemoryCandidates()]);
    showToast('记忆面板已刷新');
  });
}

function bindEvents() {
  const events = new EventSource('/api/events');
  events.onmessage = (message) => {
    const event = JSON.parse(message.data);
    upsertActivity(event);
  };
}

async function loadHealth() {
  const health = await requestJson('/api/health');
  el.vaultRoot.textContent = health.vaultPath;
  el.vaultRoot.title = health.vaultPath;
}

async function loadTree() {
  el.treePanel.textContent = '加载中…';
  const result = await requestJson('/api/vault/tree');
  el.vaultRoot.textContent = result.root;
  el.vaultRoot.title = result.root;
  renderTree(result.tree ?? []);
}

async function loadActivity() {
  const result = await requestJson('/api/activity');
  state.activities = result.activities ?? [];
  renderActivities();
}

async function loadJobs() {
  const result = await requestJson('/api/jobs');
  renderJobs(result.jobs ?? []);
}

async function loadSync() {
  const result = await requestJson('/api/sync');
  state.syncStatus = result.status ?? null;
  state.syncJobs = result.jobs ?? [];
  renderSync();
}

async function loadConversation() {
  const result = await requestJson(`/api/conversations/messages?threadId=${encodeURIComponent(state.threadId)}`);
  state.conversationMessages = result.messages ?? [];
  state.threadSummary = result.summary ?? null;
  renderConversation();
  renderThreadSummary();
}

async function loadMemoryCandidates() {
  const result = await requestJson('/api/memory-candidates?status=all');
  state.memoryCandidates = result.candidates ?? [];
  renderMemoryCandidates();
}

function renderTree(nodes) {
  el.treePanel.innerHTML = '';
  if (nodes.length === 0) {
    el.treePanel.textContent = '还没有 Markdown 文件。';
    return;
  }
  el.treePanel.appendChild(createTreeList(nodes));
}

function createTreeList(nodes) {
  const list = document.createElement('ul');
  list.className = 'tree-list';
  for (const node of nodes) {
    const item = document.createElement('li');
    if (node.type === 'directory') {
      const details = document.createElement('details');
      details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = node.name;
      details.appendChild(summary);
      if (node.children?.length) details.appendChild(createTreeList(node.children));
      item.appendChild(details);
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = node.path === state.selectedPath ? 'tree-file selected' : 'tree-file';
      button.textContent = node.name;
      button.title = node.path;
      button.addEventListener('click', () => openFile(node.path));
      item.appendChild(button);
    }
    list.appendChild(item);
  }
  return list;
}

async function openFile(path) {
  if (isDirty() && !window.confirm('当前文件有未保存修改，确定切换吗？')) return;
  const file = await requestJson(`/api/vault/files?path=${encodeURIComponent(path)}`);
  state.selectedPath = file.path;
  state.savedContent = file.content;
  state.draftContent = file.content;
  el.selectedPath.textContent = file.path;
  el.updatedAt.textContent = `最后修改：${new Date(file.updatedAt).toLocaleString()}`;
  el.editor.disabled = false;
  el.editor.value = file.content;
  renderSaveState();
  renderTreeSelection();
}

async function saveFile() {
  if (!state.selectedPath || !isDirty()) return;
  el.saveFile.disabled = true;
  el.saveFile.textContent = '保存中…';
  try {
    const result = await requestJson('/api/vault/files', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.selectedPath, content: state.draftContent }),
    });
    state.savedContent = result.file.content;
    state.draftContent = result.file.content;
    el.updatedAt.textContent = `最后修改：${new Date(result.file.updatedAt).toLocaleString()}`;
    showToast(result.syncJob ? `已保存，sync job ${result.syncJob.id} 已排队` : '已保存');
    await Promise.all([loadTree(), loadActivity(), loadSync()]);
  } catch (error) {
    showToast(getErrorMessage(error), true);
  } finally {
    el.saveFile.textContent = '保存 ⌘S';
    renderSaveState();
  }
}

function renderSaveState() {
  const dirty = isDirty();
  el.saveState.textContent = !state.selectedPath ? '未选择' : dirty ? '未保存' : '已保存';
  el.saveState.className = `save-state ${dirty ? 'dirty' : 'clean'}`;
  el.saveFile.disabled = !state.selectedPath || !dirty;
}

function renderTreeSelection() {
  for (const button of document.querySelectorAll('.tree-file')) {
    button.classList.toggle('selected', button.title === state.selectedPath);
  }
}

function renderSources(sources) {
  el.sources.innerHTML = '';
  el.sources.classList.toggle('empty-state', sources.length === 0);
  if (sources.length === 0) {
    el.sources.textContent = '没有检索到来源。';
    return;
  }
  for (const [index, source] of sources.entries()) {
    const card = document.createElement('article');
    card.className = 'source-card';
    const headings = source.headings?.length ? ` › ${source.headings.join(' › ')}` : '';
    card.innerHTML = `<strong>${index + 1}. ${escapeHtml(source.source)}${escapeHtml(headings)}</strong><p>${escapeHtml(source.content)}</p>`;
    el.sources.appendChild(card);
  }
}

function renderConversation() {
  el.conversationFeed.innerHTML = '';
  el.conversationFeed.classList.toggle('empty-state', state.conversationMessages.length === 0);
  if (state.conversationMessages.length === 0) {
    el.conversationFeed.textContent = '当前 thread 还没有消息。';
    return;
  }

  for (const message of state.conversationMessages.slice(-12)) {
    const row = document.createElement('article');
    row.className = `conversation-message ${message.role}`;
    row.innerHTML = `
      <strong>${escapeHtml(message.role)}</strong>
      <small>${new Date(message.createdAt).toLocaleString()}</small>
      <p>${escapeHtml(message.content)}</p>
    `;
    el.conversationFeed.appendChild(row);
  }
}

function renderThreadSummary() {
  el.threadSummary.classList.toggle('empty-state', !state.threadSummary);
  el.threadSummary.textContent = state.threadSummary?.summary ?? '暂无摘要。';
}

function renderMemoryCandidates() {
  el.memoryCandidates.innerHTML = '';
  el.memoryCandidates.classList.toggle('empty-state', state.memoryCandidates.length === 0);
  if (state.memoryCandidates.length === 0) {
    el.memoryCandidates.textContent = '暂无候选记忆。';
    return;
  }

  for (const candidate of state.memoryCandidates) {
    const card = document.createElement('article');
    card.className = 'memory-card';
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(candidate.target)} · ${escapeHtml(candidate.status)}</strong>
        <small>${escapeHtml(candidate.reason)}</small>
      </div>
      <p>${escapeHtml(candidate.content)}</p>
      <div class="memory-actions">
        ${candidate.status === 'proposed' ? '<button type="button" data-action="accepted">Accept</button><button type="button" data-action="rejected">Reject</button>' : ''}
        ${candidate.status === 'accepted' ? '<button type="button" data-action="write">Write to Vault</button>' : ''}
      </div>
    `;
    for (const button of card.querySelectorAll('button')) {
      button.addEventListener('click', async () => {
        if (button.dataset.action === 'write') {
          const result = await requestJson(`/api/memory-candidates/${candidate.id}/write`, { method: 'POST' });
          showToast(result.syncJob ? `已写入 ${result.file.path}，sync job ${result.syncJob.id} 已排队` : `已写入 ${result.file.path}`);
        } else {
          await requestJson(`/api/memory-candidates/${candidate.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: button.dataset.action }),
          });
        }
        await Promise.all([loadMemoryCandidates(), loadActivity(), loadSync()]);
      });
    }
    el.memoryCandidates.appendChild(card);
  }
}

function upsertActivity(event) {
  state.activities = [event, ...state.activities.filter((item) => item.id !== event.id)].slice(0, 100);
  renderActivities();
}

function renderActivities() {
  el.activityFeed.innerHTML = '';
  el.activityFeed.classList.toggle('empty-state', state.activities.length === 0);
  if (state.activities.length === 0) {
    el.activityFeed.textContent = '等待文件事件…';
    return;
  }
  for (const activity of state.activities) {
    const row = document.createElement('div');
    row.className = `activity-row ${activity.type}`;
    row.innerHTML = `<span>${new Date(activity.createdAt).toLocaleTimeString()}</span><strong>${escapeHtml(activity.type)}</strong><p>${escapeHtml(activity.message)}</p>`;
    el.activityFeed.appendChild(row);
  }
}

function renderSync() {
  if (!state.syncStatus) {
    el.syncStatus.textContent = '暂无状态。';
    el.syncJobs.textContent = '暂无任务。';
    return;
  }

  el.syncStatus.classList.remove('empty-state');
  el.syncStatus.innerHTML = Object.entries(state.syncStatus)
    .map(([key, value]) => `<span><strong>${escapeHtml(key)}</strong>${escapeHtml(value)}</span>`)
    .join('');

  el.syncJobs.innerHTML = '';
  el.syncJobs.classList.toggle('empty-state', state.syncJobs.length === 0);
  if (state.syncJobs.length === 0) {
    el.syncJobs.textContent = '暂无 sync jobs。';
    return;
  }

  for (const job of state.syncJobs.slice(0, 20)) {
    const row = document.createElement('div');
    row.className = `sync-job ${job.status}`;
    row.innerHTML = `
      <strong>#${escapeHtml(job.id)} ${escapeHtml(job.type)}</strong>
      <span>${escapeHtml(job.status)} · attempts ${escapeHtml(job.attempts)}</span>
      <p>${escapeHtml(job.path ?? 'vault')} ${job.errorMessage ? '· ' + escapeHtml(job.errorMessage) : ''}</p>
    `;
    el.syncJobs.appendChild(row);
  }
}

function renderJobs(jobs) {
  el.jobs.innerHTML = '';
  el.jobs.classList.toggle('empty-state', jobs.length === 0);
  if (jobs.length === 0) {
    el.jobs.textContent = '暂无任务。';
    return;
  }
  for (const job of jobs) {
    const card = document.createElement('article');
    card.className = 'job-card';
    card.innerHTML = `
      <div>
        <h3>${escapeHtml(job.title)}</h3>
        <p>${escapeHtml(job.description)}</p>
        <small>status: ${escapeHtml(job.status)} · last: ${escapeHtml(job.lastResult ?? 'never')}</small>
      </div>
      <button type="button">Run now</button>
    `;
    card.querySelector('button').addEventListener('click', async () => {
      await requestJson(`/api/jobs/${job.id}/run`, { method: 'POST' });
      await Promise.all([loadJobs(), loadActivity(), loadSync()]);
    });
    el.jobs.appendChild(card);
  }
}

function isDirty() {
  return state.draftContent !== state.savedContent;
}

async function requestJson(path, init) {
  const response = await fetch(path, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message ?? `HTTP ${response.status}`);
  return payload;
}

function showToast(message, danger = false) {
  el.toast.textContent = message;
  el.toast.className = `toast ${danger ? 'danger' : ''}`;
  el.toast.hidden = false;
  setTimeout(() => { el.toast.hidden = true; }, 3200);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}
