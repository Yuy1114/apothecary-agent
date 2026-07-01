const state = {
  selectedPath: null,
  savedContent: '',
  draftContent: '',
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
};

boot().catch((error) => showToast(error.message, true));

async function boot() {
  bindTabs();
  bindEditor();
  bindChat();
  await Promise.all([loadHealth(), loadTree()]);
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
      const result = await requestJson('/rag/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, topK: 5 }),
      });
      el.answer.textContent = result.answer || '没有生成回答。';
      el.question.value = '';
      renderSources(result.sources ?? []);
    } catch (error) {
      el.answer.textContent = getErrorMessage(error);
      el.sources.textContent = '失败';
    }
  });

  el.reindex.addEventListener('click', async () => {
    el.reindex.disabled = true;
    el.reindex.textContent = 'Indexing…';
    try {
      await requestJson('/index', { method: 'POST' });
      showToast('Reindex queued — watch console for "Reindex complete"');
    } catch (error) {
      showToast(getErrorMessage(error), true);
    } finally {
      el.reindex.disabled = false;
      el.reindex.textContent = 'Reindex Vault';
    }
  });
}

async function loadHealth() {
  const health = await requestJson('/health');
  el.vaultRoot.textContent = health.vaultPath;
  el.vaultRoot.title = health.vaultPath;
}

async function loadTree() {
  el.treePanel.textContent = '加载中…';
  const result = await requestJson('/vault/tree');
  el.vaultRoot.textContent = result.root;
  el.vaultRoot.title = result.root;
  renderTree(result.tree ?? []);
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
  const file = await requestJson(`/vault/files?path=${encodeURIComponent(path)}`);
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
    const result = await requestJson('/vault/files', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.selectedPath, content: state.draftContent }),
    });
    state.savedContent = result.file.content;
    state.draftContent = result.file.content;
    el.updatedAt.textContent = `最后修改：${new Date(result.file.updatedAt).toLocaleString()}`;
    showToast('已保存');
    await loadTree();
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
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast ${danger ? 'danger' : ''}`;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 3200);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'\"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}
