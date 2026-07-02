const SETTINGS_KEY = 'dotmd-settings';

const VALID_THEMES = [
  'system', 'light', 'dark', 'sepia', 'nord',
  'solarized-light', 'solarized-dark', 'dracula', 'gruvbox',
  'rose', 'forest', 'high-contrast',
];

const DARK_THEMES = new Set([
  'dark', 'nord', 'solarized-dark', 'dracula', 'gruvbox', 'forest', 'high-contrast',
]);

const DEFAULT_SETTINGS = {
  appearance: { theme: 'system' },
  preview: {
    fontSize: 15,
    fontFamily: '__system__',
    maxWidth: 760,
    lineHeight: 1.7,
  },
  editor: {
    fontSize: 14,
    fontFamily: '__system__',
    lineWrap: true,
    spellcheck: true,
    tabSize: 2,
    insertSpaces: true,
  },
  markdown: {
    breaks: false,
    defaultMode: 'view',
  },
  files: {
    autoRefresh: true,
    autoSave: false,
    autoSaveInterval: 60,
  },
  sidebar: {
    collapsed: false,
  },
};

const state = {
  mode: 'view',
  currentFilePath: null,
  currentFolderPath: null,
  folderItems: [],
  content: '',
  isDirty: false,
  fileMissing: false,
  fileListFilter: '',
  findQuery: '',
  findIndex: 0,
  findMatches: [],
  settings: null,
  autoSaveTimer: null,
  systemFonts: null,
  systemFontsPromise: null,
  splitSyncLock: false,
};

const $ = (sel) => document.querySelector(sel);

const elements = {
  sidebar: $('#sidebar'),
  folderName: $('#folder-name'),
  fileList: $('#file-list'),
  fileListSearch: $('#file-list-search'),
  fileListEmpty: $('#file-list-empty'),
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
  btnSettings: $('#btn-settings'),
  btnToggleSidebar: $('#btn-toggle-sidebar'),
  btnRefreshFolder: $('#btn-refresh-folder'),
  modeBtns: document.querySelectorAll('.mode-btn'),
  findBar: $('#find-bar'),
  findInput: $('#find-input'),
  findCount: $('#find-count'),
  findPrev: $('#find-prev'),
  findNext: $('#find-next'),
  findClose: $('#find-close'),
  settingsOverlay: $('#settings-overlay'),
  settingsClose: $('#settings-close'),
};

const FILE_ICON =
  '<svg class="file-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<path d="M14 3v5h5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

const SYSTEM_FONT_DEFAULT = '__system__';
const PREVIEW_FONT_FALLBACK = 'system-ui, sans-serif';
const EDITOR_FONT_FALLBACK = 'ui-monospace, monospace';

const LEGACY_FONT_KEYS = new Set([
  'sans', 'serif', 'mono', 'rounded',
  'palatino', 'charter', 'baskerville', 'humanist',
  'sf-mono', 'jetbrains', 'fira', 'source', 'cascadia', 'consolas', 'monaco',
]);

function cssFontFamily(stored, fallback) {
  if (!stored || stored === SYSTEM_FONT_DEFAULT) return fallback;
  const escaped = stored.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}", ${fallback}`;
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* ---------- Settings ---------- */
function migrateLegacyTheme(settings) {
  if (localStorage.getItem(SETTINGS_KEY)) return;

  const legacy = localStorage.getItem('theme');
  if (legacy === 'light' || legacy === 'dark') {
    settings.appearance.theme = legacy;
  }
  localStorage.removeItem('theme');
}

function normalizeSettings(settings) {
  if (!VALID_THEMES.includes(settings.appearance.theme)) {
    settings.appearance.theme = 'system';
  }
  if (LEGACY_FONT_KEYS.has(settings.preview.fontFamily)) {
    settings.preview.fontFamily = SYSTEM_FONT_DEFAULT;
  }
  if (LEGACY_FONT_KEYS.has(settings.editor.fontFamily)) {
    settings.editor.fontFamily = SYSTEM_FONT_DEFAULT;
  }
  return settings;
}

async function ensureSystemFonts() {
  if (state.systemFonts) return state.systemFonts;
  if (!state.systemFontsPromise) {
    state.systemFontsPromise = window.api
      .getSystemFonts()
      .then((fonts) => {
        state.systemFonts = Array.isArray(fonts) ? fonts : [];
        state.systemFontsPromise = null;
        return state.systemFonts;
      })
      .catch(() => {
        state.systemFonts = [];
        state.systemFontsPromise = null;
        return state.systemFonts;
      });
  }
  return state.systemFontsPromise;
}

function setFontSelectsLoading(loading) {
  for (const wrapId of ['preview-font-wrap', 'editor-font-wrap']) {
    const wrap = document.getElementById(wrapId);
    const select = wrap?.querySelector('select');
    if (!wrap || !select) continue;
    wrap.classList.toggle('loading', loading);
    select.disabled = loading;
  }
}

function showFontSelectsLoadingState() {
  const configs = [
    ['setting-preview-font-family', state.settings.preview.fontFamily],
    ['setting-editor-font-family', state.settings.editor.fontFamily],
  ];

  for (const [selectId, savedValue] of configs) {
    const select = document.getElementById(selectId);
    if (!select) continue;
    const current = savedValue || SYSTEM_FONT_DEFAULT;
    select.innerHTML = '';
    const option = document.createElement('option');
    option.value = current;
    option.textContent = 'Loading fonts…';
    select.appendChild(option);
    select.value = current;
  }

  setFontSelectsLoading(true);
}

function populateFontSelect(selectId, selectedValue) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const current = selectedValue || SYSTEM_FONT_DEFAULT;
  select.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = SYSTEM_FONT_DEFAULT;
  defaultOption.textContent = 'System Default';
  select.appendChild(defaultOption);

  const seen = new Set([SYSTEM_FONT_DEFAULT]);
  for (const font of state.systemFonts || []) {
    if (seen.has(font)) continue;
    seen.add(font);
    const option = document.createElement('option');
    option.value = font;
    option.textContent = font;
    select.appendChild(option);
  }

  if (current !== SYSTEM_FONT_DEFAULT && !seen.has(current)) {
    const missing = document.createElement('option');
    missing.value = current;
    missing.textContent = `${current} (unavailable)`;
    select.appendChild(missing);
  }

  select.value = current;
}

function populateFontSelects() {
  populateFontSelect('setting-preview-font-family', state.settings.preview.fontFamily);
  populateFontSelect('setting-editor-font-family', state.settings.editor.fontFamily);
  setFontSelectsLoading(false);
}

function ensureFontSelectsReady() {
  if (state.systemFonts) {
    populateFontSelects();
    return;
  }

  showFontSelectsLoadingState();
  ensureSystemFonts()
    .then(() => {
      if (!elements.settingsOverlay.classList.contains('hidden')) {
        populateFontSelects();
      }
    })
    .catch(() => {
      if (!elements.settingsOverlay.classList.contains('hidden')) {
        populateFontSelects();
      }
    });
}

function applySystemFonts(fonts) {
  if (!Array.isArray(fonts) || !fonts.length) return;
  state.systemFonts = fonts;
}

function preloadSystemFonts() {
  ensureSystemFonts()
    .then((fonts) => {
      applySystemFonts(fonts);
    })
    .catch(() => {});
}

function loadSettings() {
  let settings = structuredClone(DEFAULT_SETTINGS);
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      settings = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        appearance: { ...DEFAULT_SETTINGS.appearance, ...parsed.appearance },
        preview: { ...DEFAULT_SETTINGS.preview, ...parsed.preview },
        editor: { ...DEFAULT_SETTINGS.editor, ...parsed.editor },
        markdown: { ...DEFAULT_SETTINGS.markdown, ...parsed.markdown },
        files: { ...DEFAULT_SETTINGS.files, ...parsed.files },
        sidebar: { ...DEFAULT_SETTINGS.sidebar, ...parsed.sidebar },
      };
    }
  } catch {
    /* use defaults */
  }
  migrateLegacyTheme(settings);
  return normalizeSettings(settings);
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function applyThemeSetting() {
  const themeSetting = state.settings.appearance.theme;

  if (themeSetting === 'system') {
    const resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-mode', resolved);
    return;
  }

  document.documentElement.setAttribute('data-theme', themeSetting);
  document.documentElement.setAttribute('data-theme-mode', DARK_THEMES.has(themeSetting) ? 'dark' : 'light');
}

function applySettings() {
  const { preview, editor, markdown } = state.settings;
  const root = document.documentElement;

  applyThemeSetting();

  root.style.setProperty('--preview-font-size', `${preview.fontSize}px`);
  root.style.setProperty('--preview-max-width', `${preview.maxWidth}px`);
  root.style.setProperty('--preview-line-height', String(preview.lineHeight));
  root.style.setProperty('--preview-font', cssFontFamily(preview.fontFamily, PREVIEW_FONT_FALLBACK));

  root.style.setProperty('--editor-font-size', `${editor.fontSize}px`);
  root.style.setProperty('--editor-font', cssFontFamily(editor.fontFamily, EDITOR_FONT_FALLBACK));
  root.style.setProperty('--editor-tab-size', String(editor.tabSize));

  elements.editor.style.whiteSpace = editor.lineWrap ? 'pre-wrap' : 'pre';
  elements.editor.style.overflowWrap = editor.lineWrap ? 'break-word' : 'normal';
  elements.editor.spellcheck = editor.spellcheck;
  elements.editor.style.tabSize = editor.tabSize;

  marked.setOptions({
    gfm: true,
    breaks: markdown.breaks,
  });

  applySidebarCollapsed();
  updateAutoSaveTimer();
  updatePreview();
}

function updateSetting(path, value) {
  const keys = path.split('.');
  let target = state.settings;
  for (let i = 0; i < keys.length - 1; i += 1) {
    target = target[keys[i]];
  }
  target[keys[keys.length - 1]] = value;
  saveSettings();
  applySettings();
}

function syncSettingsForm() {
  const s = state.settings;
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!val;
    else el.value = String(val);
  };

  setVal('setting-theme', s.appearance.theme);
  setVal('setting-preview-font-size', s.preview.fontSize);
  setVal('setting-preview-font-family', s.preview.fontFamily);
  setVal('setting-preview-max-width', s.preview.maxWidth);
  setVal('setting-preview-line-height', s.preview.lineHeight);
  setVal('setting-editor-font-size', s.editor.fontSize);
  setVal('setting-editor-font-family', s.editor.fontFamily);
  setVal('setting-editor-tab-size', s.editor.tabSize);
  setVal('setting-editor-line-wrap', s.editor.lineWrap);
  setVal('setting-editor-spellcheck', s.editor.spellcheck);
  setVal('setting-editor-insert-spaces', s.editor.insertSpaces);
  setVal('setting-markdown-breaks', s.markdown.breaks);
  setVal('setting-default-mode', s.markdown.defaultMode);
  setVal('setting-auto-refresh', s.files.autoRefresh);
  setVal('setting-auto-save', s.files.autoSave);
  setVal('setting-auto-save-interval', s.files.autoSaveInterval);
}

function openSettings() {
  syncSettingsForm();
  elements.settingsOverlay.classList.remove('hidden');
  elements.settingsOverlay.setAttribute('aria-hidden', 'false');
  ensureFontSelectsReady();
}

function closeSettings() {
  elements.settingsOverlay.classList.add('hidden');
  elements.settingsOverlay.setAttribute('aria-hidden', 'true');
}

async function initSettings() {
  state.settings = loadSettings();
  applySettings();
  preloadSystemFonts();

  elements.btnSettings.addEventListener('click', openSettings);
  elements.settingsClose.addEventListener('click', closeSettings);
  elements.settingsOverlay.addEventListener('click', (e) => {
    if (e.target === elements.settingsOverlay) closeSettings();
  });

  const bindings = [
    ['setting-theme', 'appearance.theme', 'select'],
    ['setting-preview-font-size', 'preview.fontSize', 'number'],
    ['setting-preview-font-family', 'preview.fontFamily', 'select'],
    ['setting-preview-max-width', 'preview.maxWidth', 'number'],
    ['setting-preview-line-height', 'preview.lineHeight', 'float'],
    ['setting-editor-font-size', 'editor.fontSize', 'number'],
    ['setting-editor-font-family', 'editor.fontFamily', 'select'],
    ['setting-editor-tab-size', 'editor.tabSize', 'number'],
    ['setting-editor-line-wrap', 'editor.lineWrap', 'checkbox'],
    ['setting-editor-spellcheck', 'editor.spellcheck', 'checkbox'],
    ['setting-editor-insert-spaces', 'editor.insertSpaces', 'checkbox'],
    ['setting-markdown-breaks', 'markdown.breaks', 'checkbox'],
    ['setting-default-mode', 'markdown.defaultMode', 'select'],
    ['setting-auto-refresh', 'files.autoRefresh', 'checkbox'],
    ['setting-auto-save', 'files.autoSave', 'checkbox'],
    ['setting-auto-save-interval', 'files.autoSaveInterval', 'number'],
  ];

  bindings.forEach(([id, path, type]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      let value = type === 'checkbox' ? el.checked : el.value;
      if (type === 'number' || type === 'float') {
        value = type === 'float' ? parseFloat(value) : parseInt(value, 10);
        if (Number.isNaN(value)) return;
      }
      updateSetting(path, value);

      if (path === 'files.autoRefresh' && state.currentFolderPath) {
        if (value) startFolderWatch(state.currentFolderPath);
        else window.api.unwatchFolder();
      }
    });
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.settings.appearance.theme === 'system') {
      applyThemeSetting();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !elements.settingsOverlay.classList.contains('hidden')) {
      closeSettings();
    }
  });
}

/* ---------- Sidebar ---------- */
function applySidebarCollapsed() {
  const collapsed = state.settings.sidebar.collapsed;
  elements.sidebar.classList.toggle('collapsed', collapsed);
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  elements.btnToggleSidebar.classList.toggle('active', !collapsed && !!state.currentFolderPath);
}

function toggleSidebar() {
  if (!state.currentFolderPath) return;
  updateSetting('sidebar.collapsed', !state.settings.sidebar.collapsed);
}

function updateSidebarToggleState() {
  const hasFolder = !!state.currentFolderPath;
  elements.btnToggleSidebar.disabled = !hasFolder;
  document.body.classList.toggle('folder-open', hasFolder);
  applySidebarCollapsed();
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
  refreshFindHighlights();
  if (mode === 'split') {
    requestAnimationFrame(() => syncPreviewToEditorCursor());
  }
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
  annotatePreviewWithSourceLines(state.content || '');
  await resolvePreviewImages();
  refreshFindHighlights();
  if (state.mode === 'split') {
    requestAnimationFrame(() => syncPreviewToEditorCursor());
  }
}

/* ---------- Split scroll sync ---------- */
function buildBlockLineMap(markdown) {
  const blocks = [];
  const tokens = marked.lexer(markdown);
  let searchFrom = 0;

  for (const token of tokens) {
    if (token.type === 'space') continue;

    const idx = markdown.indexOf(token.raw, searchFrom);
    if (idx === -1) {
      searchFrom += token.raw.length;
      continue;
    }

    blocks.push({
      startLine: markdown.slice(0, idx).split('\n').length - 1,
      type: token.type,
    });
    searchFrom = idx + token.raw.length;
  }

  return blocks;
}

function annotatePreviewWithSourceLines(markdown) {
  const blocks = buildBlockLineMap(markdown);
  const children = elements.preview.children;

  for (let i = 0; i < children.length && i < blocks.length; i += 1) {
    children[i].dataset.sourceLine = String(blocks[i].startLine);
  }
}

function getEditorCursorLine() {
  const text = elements.editor.value.slice(0, elements.editor.selectionStart);
  return text.split('\n').length - 1;
}

function getEditorCaretViewportY() {
  const editor = elements.editor;
  const style = getComputedStyle(editor);
  const editorRect = editor.getBoundingClientRect();
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const lineHeight = parseFloat(style.lineHeight) || 20;
  const lineWrap = editor.style.whiteSpace === 'pre-wrap' || style.whiteSpace === 'pre-wrap';

  if (!lineWrap) {
    return editorRect.top + paddingTop + getEditorCursorLine() * lineHeight - editor.scrollTop;
  }

  const before = editor.value.slice(0, editor.selectionStart);
  const mirror = getEditorMirror();
  syncEditorMirrorStyles();
  mirror.textContent = before;

  const marker = document.createElement('span');
  marker.textContent = '.';
  mirror.appendChild(marker);
  const caretTop = marker.offsetTop;
  mirror.textContent = '';

  return editorRect.top + paddingTop + caretTop - editor.scrollTop;
}

let editorMirror = null;

function getEditorMirror() {
  if (!editorMirror) {
    editorMirror = document.createElement('div');
    editorMirror.className = 'editor-scroll-mirror';
    editorMirror.setAttribute('aria-hidden', 'true');
    document.body.appendChild(editorMirror);
  }
  return editorMirror;
}

function syncEditorMirrorStyles() {
  const editor = elements.editor;
  const mirror = getEditorMirror();
  const style = getComputedStyle(editor);
  mirror.style.font = style.font;
  mirror.style.padding = style.padding;
  mirror.style.width = `${editor.clientWidth}px`;
  mirror.style.whiteSpace = editor.style.whiteSpace || style.whiteSpace;
  mirror.style.overflowWrap = editor.style.overflowWrap || style.overflowWrap;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.tabSize = style.tabSize;
}

function findPreviewBlockForLine(line) {
  const blocks = elements.preview.querySelectorAll('[data-source-line]');
  if (!blocks.length) return null;

  let target = blocks[0];
  for (const block of blocks) {
    const blockLine = parseInt(block.dataset.sourceLine, 10);
    if (Number.isNaN(blockLine)) continue;
    if (blockLine <= line) target = block;
    else break;
  }
  return target;
}

function syncPreviewToEditorCursor() {
  if (state.mode !== 'split' || state.splitSyncLock) return;

  const target = findPreviewBlockForLine(getEditorCursorLine());
  if (!target) return;

  const previewPane = elements.previewPane;
  const caretY = getEditorCaretViewportY();
  const targetY = target.getBoundingClientRect().top;
  const delta = targetY - caretY;

  if (Math.abs(delta) < 1) return;

  state.splitSyncLock = true;
  previewPane.scrollTop += delta;
  state.splitSyncLock = false;
}

const scheduleSplitScrollSync = debounce(() => {
  if (state.mode === 'split') syncPreviewToEditorCursor();
}, 16);

const debouncedPreview = debounce(updatePreview, 60);

/* ---------- Status / dirty ---------- */
function setDirty(dirty) {
  state.isDirty = dirty;
  elements.btnSave.disabled = !dirty || !state.currentFilePath;
  updateStatus();
  updateAutoSaveTimer();
}

function updateStatus() {
  document.body.classList.toggle('file-open', !!state.currentFilePath);

  if (!state.currentFilePath) {
    elements.statusFile.textContent = 'No file open';
    elements.statusStats.textContent = '';
    return;
  }

  const name = state.currentFilePath.split(/[/\\]/).pop();
  let label = name;
  if (state.fileMissing) label += '  •  File deleted';
  else if (state.isDirty) label += '  •  Unsaved';
  elements.statusFile.textContent = label;

  const text = state.content || '';
  const words = (text.trim().match(/\S+/g) || []).length;
  elements.statusStats.textContent = `${words} words · ${text.length} chars`;
}

function updateAutoSaveTimer() {
  if (state.autoSaveTimer) {
    clearInterval(state.autoSaveTimer);
    state.autoSaveTimer = null;
  }

  const { autoSave, autoSaveInterval } = state.settings.files;
  if (!autoSave || !state.currentFilePath || state.fileMissing) return;

  state.autoSaveTimer = setInterval(() => {
    if (state.isDirty && state.currentFilePath) saveFile({ silent: true });
  }, autoSaveInterval * 1000);
}

/* ---------- Folder refresh ---------- */
async function startFolderWatch(folderPath) {
  if (!state.settings.files.autoRefresh) return;
  await window.api.watchFolder(folderPath);
}

async function stopFolderWatch() {
  await window.api.unwatchFolder();
}

async function refreshFolderList() {
  if (!state.currentFolderPath) return;

  try {
    const items = await window.api.listFolder(state.currentFolderPath);
    applyFolderItems(items);
  } catch (err) {
    console.error('Could not refresh folder:', err);
  }
}

function applyFolderItems(items) {
  state.folderItems = items;
  if (state.currentFilePath) {
    state.fileMissing = !items.some((item) => item.path === state.currentFilePath);
  }
  renderFileList();
  updateStatus();
}

function handleFolderChanged({ folderPath, items }) {
  if (folderPath !== state.currentFolderPath) return;
  applyFolderItems(items);
}

/* ---------- Workspace ---------- */
function showWorkspace() {
  elements.emptyState.classList.add('hidden');
  elements.editorPane.classList.remove('hidden');
  elements.previewPane.classList.remove('hidden');
  setMode(state.mode);
}

function getFilteredItems() {
  const query = state.fileListFilter.trim().toLowerCase();
  if (!query) return state.folderItems;
  return state.folderItems.filter((item) => item.name.toLowerCase().includes(query));
}

function renderFileList() {
  elements.fileList.innerHTML = '';
  const items = getFilteredItems();

  items.forEach((item, index) => {
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

  const showEmpty = state.folderItems.length > 0 && items.length === 0;
  elements.fileListEmpty.classList.toggle('hidden', !showEmpty);
}

function updateActiveFile() {
  elements.fileList.querySelectorAll('li').forEach((li) => {
    li.classList.toggle('active', li.dataset.path === state.currentFilePath);
  });
}

async function showSidebar(folderPath, folderName, items) {
  await stopFolderWatch();
  state.currentFolderPath = folderPath;
  state.folderItems = items;
  state.fileListFilter = '';
  elements.fileListSearch.value = '';
  elements.folderName.textContent = folderName;
  elements.sidebar.classList.remove('hidden');
  updateSidebarToggleState();
  renderFileList();
  await startFolderWatch(folderPath);
}

async function hideSidebar() {
  await stopFolderWatch();
  state.currentFolderPath = null;
  state.folderItems = [];
  state.fileListFilter = '';
  elements.fileListSearch.value = '';
  elements.sidebar.classList.add('hidden');
  elements.fileList.innerHTML = '';
  elements.fileListEmpty.classList.add('hidden');
  updateSidebarToggleState();
}

async function loadFile(filePath, content) {
  state.currentFilePath = filePath;
  state.content = content;
  state.fileMissing = false;
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
        await showSidebar(folderPath, folderName, items);
      } else {
        await hideSidebar();
      }
    } catch {
      await hideSidebar();
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
    await hideSidebar();
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

    await showSidebar(result.folderPath, result.folderName, result.items);

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

async function saveFile({ silent = false } = {}) {
  if (!state.currentFilePath || !state.isDirty) return;
  try {
    await window.api.saveFile(state.currentFilePath, state.content);
    setDirty(false);
    state.fileMissing = false;
    updateStatus();
  } catch (err) {
    if (!silent) alert(`Could not save file:\n${err.message}`);
  }
}

function closeFile() {
  if (!state.currentFilePath) return;
  if (state.isDirty && !confirm('You have unsaved changes. Close without saving?')) return;

  closeFindBar();
  state.currentFilePath = null;
  state.content = '';
  state.fileMissing = false;
  elements.editor.value = '';
  elements.preview.innerHTML = '';
  elements.emptyState.classList.remove('hidden');
  elements.editorPane.classList.add('hidden');
  elements.previewPane.classList.add('hidden');
  updateActiveFile();
  setDirty(false);
}

/* ---------- File list search ---------- */
function initFileListSearch() {
  elements.fileListSearch.addEventListener('input', () => {
    state.fileListFilter = elements.fileListSearch.value;
    renderFileList();
  });
}

/* ---------- In-file find ---------- */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getFindMatches() {
  const query = state.findQuery.trim();
  if (!query) return [];

  const haystack = state.content || '';
  const regex = new RegExp(escapeRegExp(query), 'gi');
  const matches = [];
  let match = regex.exec(haystack);
  while (match) {
    matches.push({ start: match.index, end: match.index + match[0].length });
    match = regex.exec(haystack);
  }
  return matches;
}

function updateFindCount() {
  const total = state.findMatches.length;
  if (!state.findQuery.trim()) {
    elements.findCount.textContent = '';
    return;
  }
  if (total === 0) {
    elements.findCount.textContent = 'No results';
    return;
  }
  elements.findCount.textContent = `${state.findIndex + 1} of ${total}`;
}

function clearPreviewHighlights() {
  elements.preview.querySelectorAll('mark.search-hit, mark.search-hit-current').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
}

function highlightPreviewMatches() {
  clearPreviewHighlights();
  const query = state.findQuery.trim();
  if (!query) return;

  const regex = new RegExp(escapeRegExp(query), 'gi');
  const walker = document.createTreeWalker(elements.preview, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    if (walker.currentNode.parentElement?.closest('code, pre')) continue;
    textNodes.push(walker.currentNode);
  }

  let globalIndex = 0;
  textNodes.forEach((node) => {
    const text = node.nodeValue;
    if (!text) return;

    regex.lastIndex = 0;
    let match = regex.exec(text);
    if (!match) return;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;

    while (match) {
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.dataset.findIndex = String(globalIndex);
      mark.textContent = match[0];
      frag.appendChild(mark);
      globalIndex += 1;
      lastIndex = match.index + match[0].length;
      match = regex.exec(text);
    }

    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    node.parentNode.replaceChild(frag, node);
  });
}

function scrollToPreviewMatch(index) {
  const marks = elements.preview.querySelectorAll('mark.search-hit, mark.search-hit-current');
  elements.preview.querySelectorAll('mark.search-hit-current').forEach((el) => {
    el.classList.remove('search-hit-current');
    el.classList.add('search-hit');
  });
  if (!marks.length) return;
  const targetIndex = Math.min(index, marks.length - 1);
  const mark = elements.preview.querySelector(`mark[data-find-index="${targetIndex}"]`);
  if (mark) {
    mark.classList.remove('search-hit');
    mark.classList.add('search-hit-current');
    mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function scrollEditorToMatch(index) {
  const match = state.findMatches[index];
  if (!match) return;
  elements.editor.focus();
  elements.editor.setSelectionRange(match.start, match.end);
  scrollTextareaToSelection(elements.editor);
}

function scrollTextareaToSelection(textarea) {
  const style = window.getComputedStyle(textarea);
  const lineHeight = parseFloat(style.lineHeight) || 20;
  const textBefore = textarea.value.slice(0, textarea.selectionStart);
  const lines = textBefore.split('\n').length;
  const target = Math.max(0, (lines - 3) * lineHeight);
  textarea.scrollTop = target;
}

function refreshFindHighlights() {
  state.findMatches = getFindMatches();
  if (state.findMatches.length === 0) {
    state.findIndex = 0;
  } else if (state.findIndex >= state.findMatches.length) {
    state.findIndex = 0;
  }
  updateFindCount();

  if (elements.findBar.classList.contains('hidden') || !state.findQuery.trim()) {
    clearPreviewHighlights();
    return;
  }

  if (state.mode === 'view' || state.mode === 'split') {
    highlightPreviewMatches();
    if (state.findMatches.length) scrollToPreviewMatch(state.findIndex);
  } else {
    clearPreviewHighlights();
  }

  if (state.mode === 'edit' || state.mode === 'split') {
    if (state.findMatches.length) scrollEditorToMatch(state.findIndex);
  }
}

function openFindBar() {
  if (!state.currentFilePath) return;
  elements.findBar.classList.remove('hidden');
  elements.findInput.focus();
  elements.findInput.select();
  refreshFindHighlights();
}

function closeFindBar() {
  elements.findBar.classList.add('hidden');
  state.findQuery = '';
  state.findIndex = 0;
  state.findMatches = [];
  elements.findInput.value = '';
  elements.findCount.textContent = '';
  clearPreviewHighlights();
}

function findNext(backward = false) {
  if (!state.findMatches.length) {
    refreshFindHighlights();
    if (!state.findMatches.length) return;
  }

  if (backward) {
    state.findIndex = (state.findIndex - 1 + state.findMatches.length) % state.findMatches.length;
  } else {
    state.findIndex = (state.findIndex + 1) % state.findMatches.length;
  }

  updateFindCount();

  if (state.mode === 'view' || state.mode === 'split') {
    highlightPreviewMatches();
    scrollToPreviewMatch(state.findIndex);
  }
  if (state.mode === 'edit' || state.mode === 'split') {
    scrollEditorToMatch(state.findIndex);
  }
}

function initFindBar() {
  elements.findInput.addEventListener('input', () => {
    state.findQuery = elements.findInput.value;
    state.findIndex = 0;
    refreshFindHighlights();
  });

  elements.findNext.addEventListener('click', () => findNext(false));
  elements.findPrev.addEventListener('click', () => findNext(true));
  elements.findClose.addEventListener('click', closeFindBar);

  elements.findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findNext(e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFindBar();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openFindBar();
    }
  });
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
    scheduleSplitScrollSync();
    if (!elements.findBar.classList.contains('hidden')) {
      refreshFindHighlights();
    }
  });

  elements.editor.addEventListener('keyup', scheduleSplitScrollSync);
  elements.editor.addEventListener('click', scheduleSplitScrollSync);
  elements.editor.addEventListener('scroll', scheduleSplitScrollSync);

  document.addEventListener('selectionchange', () => {
    if (state.mode === 'split' && document.activeElement === elements.editor) {
      scheduleSplitScrollSync();
    }
  });

  elements.editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    if (!state.settings.editor.insertSpaces) return;

    e.preventDefault();
    const { selectionStart, selectionEnd, value } = elements.editor;
    const spaces = ' '.repeat(state.settings.editor.tabSize);
    elements.editor.value = value.slice(0, selectionStart) + spaces + value.slice(selectionEnd);
    const pos = selectionStart + spaces.length;
    elements.editor.setSelectionRange(pos, pos);
    elements.editor.dispatchEvent(new Event('input'));
  });
}

function initButtons() {
  ['#btn-open-file', '#empty-open-file'].forEach((sel) => $(sel).addEventListener('click', openFile));
  ['#btn-open-folder', '#empty-open-folder'].forEach((sel) => $(sel).addEventListener('click', openFolder));
  elements.btnSave.addEventListener('click', () => saveFile());
  elements.btnClose.addEventListener('click', closeFile);
  elements.btnToggleSidebar.addEventListener('click', toggleSidebar);
  elements.btnRefreshFolder.addEventListener('click', refreshFolderList);
}

function initMenuShortcuts() {
  window.api.onMenuOpenFile(() => openFile());
  window.api.onMenuOpenFolder(() => openFolder());
  window.api.onMenuSave(() => saveFile());
  window.api.onMenuCloseFile(() => closeFile());
  window.api.onMenuToggleSidebar(() => toggleSidebar());
  window.api.onMenuFind(() => openFindBar());
  window.api.onMenuSettings(() => openSettings());
  window.api.onOpenFilePath((filePath) => openFileFromPath(filePath));
  window.api.onFolderChanged((payload) => handleFolderChanged(payload));
  window.api.onFontsUpdated((fonts) => {
    applySystemFonts(fonts);
    if (!elements.settingsOverlay.classList.contains('hidden')) {
      populateFontSelects();
    }
  });
}

function initPlatform() {
  document.body.setAttribute('data-platform', window.api.platform || 'other');
}

initPlatform();
initModeSwitch();
initEditor();
initButtons();
initFileListSearch();
initFindBar();
initMenuShortcuts();

initSettings()
  .then(() => {
    setMode(state.settings.markdown.defaultMode);
    updateStatus();
    updateSidebarToggleState();
  })
  .catch((err) => {
    console.error('Failed to initialize settings:', err);
    setMode('view');
    updateStatus();
    updateSidebarToggleState();
  });
