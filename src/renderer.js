marked.setOptions({
  gfm: true,
  breaks: false,
});

const state = {
  mode: 'view',
  currentFilePath: null,
  currentFolderPath: null,
  folderItems: [],
  content: '',
  isDirty: false,
};

const $ = (sel) => document.querySelector(sel);

const elements = {
  sidebar: $('#sidebar'),
  folderName: $('#folder-name'),
  fileList: $('#file-list'),
  content: $('#content'),
  emptyState: $('#empty-state'),
  editorPane: $('#editor-pane'),
  previewPane: $('#preview-pane'),
  editor: $('#editor'),
  preview: $('#preview'),
  statusFile: $('#status-file'),
  statusMode: $('#status-mode'),
  statusStats: $('#status-stats'),
  btnSave: $('#btn-save'),
  btnClose: $('#btn-close'),
  btnTheme: $('#btn-theme'),
  modeBtns: document.querySelectorAll('.mode-btn'),
};

const FILE_ICON =
  '<svg class="file-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<path d="M14 3v5h5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

/* ---------- Theme ---------- */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));

  elements.btnTheme.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('theme')) {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });
}

/* ---------- Mode ---------- */
function setMode(mode) {
  state.mode = mode;
  elements.content.className = `content mode-${mode}`;
  elements.modeBtns.forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active);
  });
  elements.statusMode.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
  updatePreview();
}

async function resolvePreviewImages() {
  if (!state.currentFilePath) return;

  const images = elements.preview.querySelectorAll('img');
  await Promise.all(
    Array.from(images).map(async (img) => {
      const src = img.getAttribute('src');
      if (!src || /^(https?:|data:|file:|mailto:)/i.test(src.trim())) return;

      try {
        const resolved = await window.api.resolveImagePath(state.currentFilePath, src);
        if (resolved) img.src = resolved;
        else img.alt = img.alt || 'Image not found';
      } catch {
        img.alt = img.alt || 'Image not found';
      }
    }),
  );
}

async function updatePreview() {
  elements.preview.innerHTML = marked.parse(state.content || '');
  await resolvePreviewImages();
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

const debouncedPreview = debounce(updatePreview, 60);

/* ---------- Status / dirty ---------- */
function setDirty(dirty) {
  state.isDirty = dirty;
  elements.btnSave.disabled = !dirty || !state.currentFilePath;
  updateStatus();
}

function updateStatus() {
  document.body.classList.toggle('file-open', !!state.currentFilePath);

  if (!state.currentFilePath) {
    elements.statusFile.textContent = 'No file open';
    elements.statusStats.textContent = '';
    return;
  }
  const name = state.currentFilePath.split(/[/\\]/).pop();
  elements.statusFile.textContent = state.isDirty ? `${name}  •  Unsaved` : name;

  const text = state.content || '';
  const words = (text.trim().match(/\S+/g) || []).length;
  elements.statusStats.textContent = `${words} words · ${text.length} chars`;
}

/* ---------- Workspace ---------- */
function showWorkspace() {
  elements.emptyState.classList.add('hidden');
  elements.editorPane.classList.remove('hidden');
  elements.previewPane.classList.remove('hidden');
  setMode(state.mode);
}

function renderFileList() {
  elements.fileList.innerHTML = '';

  state.folderItems.forEach((item, index) => {
    const li = document.createElement('li');
    li.dataset.path = item.path;
    li.title = item.name;
    li.style.animationDelay = `${Math.min(index * 25, 400)}ms`;
    li.innerHTML = `${FILE_ICON}<span class="file-name"></span>`;
    li.querySelector('.file-name').textContent = item.name;
    li.addEventListener('click', () => selectFile(item.path));

    if (item.path === state.currentFilePath) {
      li.classList.add('active');
    }

    elements.fileList.appendChild(li);
  });
}

function updateActiveFile() {
  elements.fileList.querySelectorAll('li').forEach((li) => {
    li.classList.toggle('active', li.dataset.path === state.currentFilePath);
  });
}

function showSidebar(folderPath, folderName, items) {
  state.currentFolderPath = folderPath;
  state.folderItems = items;
  elements.folderName.textContent = folderName;
  elements.sidebar.classList.remove('hidden');
  renderFileList();
}

function hideSidebar() {
  state.currentFolderPath = null;
  state.folderItems = [];
  elements.sidebar.classList.add('hidden');
  elements.fileList.innerHTML = '';
}

async function loadFile(filePath, content) {
  state.currentFilePath = filePath;
  state.content = content;
  elements.editor.value = content;
  setDirty(false);
  showWorkspace();
  updatePreview();
  updateActiveFile();
}

async function openFileFromPath(filePath) {
  if (state.isDirty && !confirm('You have unsaved changes. Continue without saving?')) return;

  try {
    const result = await window.api.readFile(filePath);
    const folderPath = filePath.replace(/[/\\][^/\\]+$/, '');
    try {
      const items = await window.api.listFolder(folderPath);
      if (items.length) {
        const folderName = folderPath.split(/[/\\]/).pop();
        showSidebar(folderPath, folderName, items);
      } else {
        hideSidebar();
      }
    } catch {
      hideSidebar();
    }
    await loadFile(result.filePath, result.content);
  } catch (err) {
    alert(`Could not open file:\n${err.message}`);
  }
}

async function selectFile(filePath) {
  if (state.isDirty && !confirm('You have unsaved changes. Continue without saving?')) return;
  try {
    const result = await window.api.readFile(filePath);
    await loadFile(result.filePath, result.content);
  } catch (err) {
    alert(`Could not open file:\n${err.message}`);
  }
}

async function openFile() {
  if (state.isDirty && !confirm('You have unsaved changes. Continue without saving?')) return;
  try {
    const result = await window.api.openFileDialog();
    if (!result) return;
    hideSidebar();
    await loadFile(result.filePath, result.content);
  } catch (err) {
    alert(`Could not open file:\n${err.message}`);
  }
}

async function openFolder() {
  if (state.isDirty && !confirm('You have unsaved changes. Continue without saving?')) return;
  try {
    const result = await window.api.openFolderDialog();
    if (!result) return;

    showSidebar(result.folderPath, result.folderName, result.items);

    const firstFile = result.items.find((item) => item.type === 'file');
    if (firstFile) {
      await selectFile(firstFile.path);
    } else {
      elements.emptyState.classList.remove('hidden');
      elements.editorPane.classList.add('hidden');
      elements.previewPane.classList.add('hidden');
      state.currentFilePath = null;
      state.content = '';
      setDirty(false);
    }
  } catch (err) {
    alert(`Could not open folder:\n${err.message}`);
  }
}

async function saveFile() {
  if (!state.currentFilePath || !state.isDirty) return;
  try {
    await window.api.saveFile(state.currentFilePath, state.content);
    setDirty(false);
  } catch (err) {
    alert(`Could not save file:\n${err.message}`);
  }
}

function closeFile() {
  if (!state.currentFilePath) return;
  if (state.isDirty && !confirm('You have unsaved changes. Close without saving?')) return;

  state.currentFilePath = null;
  state.content = '';
  elements.editor.value = '';
  elements.preview.innerHTML = '';
  elements.emptyState.classList.remove('hidden');
  elements.editorPane.classList.add('hidden');
  elements.previewPane.classList.add('hidden');
  updateActiveFile();
  setDirty(false);
}

/* ---------- Init ---------- */
function initModeSwitch() {
  elements.modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
}

function initEditor() {
  elements.editor.addEventListener('input', () => {
    state.content = elements.editor.value;
    setDirty(true);
    debouncedPreview();
  });
}

function initButtons() {
  ['#btn-open-file', '#empty-open-file'].forEach((sel) => $(sel).addEventListener('click', openFile));
  ['#btn-open-folder', '#empty-open-folder'].forEach((sel) => $(sel).addEventListener('click', openFolder));
  elements.btnSave.addEventListener('click', saveFile);
  elements.btnClose.addEventListener('click', closeFile);
}

function initMenuShortcuts() {
  window.api.onMenuOpenFile(() => openFile());
  window.api.onMenuOpenFolder(() => openFolder());
  window.api.onMenuSave(() => saveFile());
  window.api.onMenuCloseFile(() => closeFile());
  window.api.onOpenFilePath((filePath) => openFileFromPath(filePath));
}

function initPlatform() {
  document.body.setAttribute('data-platform', window.api.platform || 'other');
}

initPlatform();
initTheme();
initModeSwitch();
initEditor();
initButtons();
initMenuShortcuts();

setMode('view');
updateStatus();
