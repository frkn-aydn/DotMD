const SETTINGS_KEY = 'dotmd-settings';
const LAST_OPENED_KEY = 'dotmd-last-opened';
const LAST_OPENED_MAX = 500;
const RECENTS_KEY = 'dotmd-recents';
const RECENTS_MAX_PER_TYPE = 10;
const SIDEBAR_WIDTH_DEFAULT = 268;
const SIDEBAR_WIDTH_MIN = 180;
const SIDEBAR_WIDTH_MAX = 480;

const TAG_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

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
    sortBy: 'name',
    sortDirection: 'asc',
    width: SIDEBAR_WIDTH_DEFAULT,
  },
  tags: {
    catalog: {},
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
  tagFilter: [],
  renamingPath: null,
  tagPopoverPath: null,
  lastOpened: {},
  recents: [],
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
  fileListSort: $('#file-list-sort'),
  btnSortDirection: $('#btn-sort-direction'),
  tagFilter: $('#tag-filter'),
  tagFilterChips: $('#tag-filter-chips'),
  tagPopover: $('#tag-popover'),
  tagPopoverInput: $('#tag-popover-input'),
  tagPopoverSuggestions: $('#tag-popover-suggestions'),
  content: $('#content'),
  emptyState: $('#empty-state'),
  emptyRecents: $('#empty-recents'),
  emptyRecentFolders: $('#empty-recent-folders'),
  emptyRecentFoldersList: $('#empty-recent-folders-list'),
  emptyRecentFiles: $('#empty-recent-files'),
  emptyRecentFilesList: $('#empty-recent-files-list'),
  sidebarResizeHandle: $('#sidebar-resize-handle'),
  editorPane: $('#editor-pane'),
  previewPane: $('#preview-pane'),
  editor: $('#editor'),
  editorHighlights: $('#editor-highlights'),
  preview: $('#preview'),
  statusFile: $('#status-file'),
  statusMode: $('#status-mode'),
  statusStats: $('#status-stats'),
  btnSave: $('#btn-save'),
  btnClose: $('#btn-close'),
  btnSettings: $('#btn-settings'),
  btnToggleSidebar: $('#btn-toggle-sidebar'),
  btnRefreshFolder: $('#btn-refresh-folder'),
  btnNewFile: $('#btn-new-file'),
  btnNewFileTop: $('#btn-new-file-top'),
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

const FOLDER_ICON =
  '<svg class="file-icon recent-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

const RECENT_FILE_ICON =
  '<svg class="file-icon recent-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<path d="M14 3v5h5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

const PIN_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M12 17v5M8 3l1.5 7H6l6 8 6-8h-3.5L16 3H8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

const TAG_PLUS_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

const SYSTEM_FONT_DEFAULT = '__system__';
const PREVIEW_FONT_FALLBACK = 'system-ui, sans-serif';
const EDITOR_FONT_FALLBACK = 'ui-monospace, monospace';

const MOD_KEY = (window.api?.platform === 'darwin') ? '⌘' : 'Ctrl+';
const MOD_SHIFT = (window.api?.platform === 'darwin') ? '⌘⇧' : 'Ctrl+Shift+';

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
        tags: {
          ...DEFAULT_SETTINGS.tags,
          ...parsed.tags,
          catalog: { ...DEFAULT_SETTINGS.tags.catalog, ...(parsed.tags?.catalog || {}) },
        },
      };
    }
  } catch {
    /* use defaults */
  }
  migrateLegacyTheme(settings);
  return normalizeSettings(settings);
}

function loadLastOpened() {
  try {
    const raw = localStorage.getItem(LAST_OPENED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLastOpened() {
  const entries = Object.entries(state.lastOpened)
    .sort((a, b) => b[1] - a[1])
    .slice(0, LAST_OPENED_MAX);
  state.lastOpened = Object.fromEntries(entries);
  localStorage.setItem(LAST_OPENED_KEY, JSON.stringify(state.lastOpened));
}

function recordLastOpened(filePath) {
  if (!filePath) return;
  state.lastOpened[filePath] = Date.now();
  saveLastOpened();
}

function loadRecents() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && (item.type === 'file' || item.type === 'folder') && item.path)
      .map((item) => ({
        path: item.path,
        type: item.type,
        name: item.name || item.path.split(/[/\\]/).pop(),
        openedAt: Number(item.openedAt) || 0,
      }));
  } catch {
    return [];
  }
}

function saveRecents() {
  localStorage.setItem(RECENTS_KEY, JSON.stringify(state.recents));
}

function recordRecent({ path: targetPath, type, name }) {
  if (!targetPath || (type !== 'file' && type !== 'folder')) return;
  const entry = {
    path: targetPath,
    type,
    name: name || targetPath.split(/[/\\]/).pop(),
    openedAt: Date.now(),
  };
  state.recents = [
    entry,
    ...state.recents.filter((item) => !(item.path === targetPath && item.type === type)),
  ];

  const folders = state.recents.filter((item) => item.type === 'folder').slice(0, RECENTS_MAX_PER_TYPE);
  const files = state.recents.filter((item) => item.type === 'file').slice(0, RECENTS_MAX_PER_TYPE);
  state.recents = [...folders, ...files].sort((a, b) => b.openedAt - a.openedAt);
  saveRecents();
  renderEmptyRecents();
}

function updateRecentPath(oldPath, newPath, newName) {
  let changed = false;
  state.recents = state.recents.map((item) => {
    if (item.path !== oldPath) return item;
    changed = true;
    return {
      ...item,
      path: newPath,
      name: newName || newPath.split(/[/\\]/).pop(),
    };
  });
  if (changed) saveRecents();
}

function removeRecent(targetPath, type) {
  const before = state.recents.length;
  state.recents = state.recents.filter((item) => !(item.path === targetPath && (!type || item.type === type)));
  if (state.recents.length !== before) {
    saveRecents();
    renderEmptyRecents();
  }
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  if (!Number.isFinite(timestamp) || diff < 0) return '';
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return 'Just now';
  if (diff < hour) {
    const mins = Math.floor(diff / minute);
    return `${mins}m ago`;
  }
  if (diff < day) {
    const hours = Math.floor(diff / hour);
    return `${hours}h ago`;
  }
  if (diff < 2 * day) return 'Yesterday';
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: new Date(timestamp).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

function basenamePath(filePath) {
  return String(filePath || '').split(/[/\\]/).pop() || filePath;
}

function getTagColor(tagName) {
  const entry = state.settings?.tags?.catalog?.[tagName];
  if (entry?.color) return entry.color;
  let hash = 0;
  for (let i = 0; i < tagName.length; i += 1) {
    hash = (hash * 31 + tagName.charCodeAt(i)) >>> 0;
  }
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

function ensureTagInCatalog(tagName) {
  if (!state.settings.tags.catalog[tagName]) {
    const used = new Set(Object.values(state.settings.tags.catalog).map((t) => t.color));
    const color = TAG_PALETTE.find((c) => !used.has(c)) || TAG_PALETTE[Object.keys(state.settings.tags.catalog).length % TAG_PALETTE.length];
    state.settings.tags.catalog[tagName] = { color };
    saveSettings();
  }
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
  const { preview, editor, markdown, sidebar } = state.settings;
  const root = document.documentElement;

  applyThemeSetting();

  root.style.setProperty('--preview-font-size', `${preview.fontSize}px`);
  root.style.setProperty('--preview-max-width', `${preview.maxWidth}px`);
  root.style.setProperty('--preview-line-height', String(preview.lineHeight));
  root.style.setProperty('--preview-font', cssFontFamily(preview.fontFamily, PREVIEW_FONT_FALLBACK));

  root.style.setProperty('--editor-font-size', `${editor.fontSize}px`);
  root.style.setProperty('--editor-font', cssFontFamily(editor.fontFamily, EDITOR_FONT_FALLBACK));
  root.style.setProperty('--editor-tab-size', String(editor.tabSize));

  applySidebarWidth(sidebar.width);

  elements.editor.style.whiteSpace = editor.lineWrap ? 'pre-wrap' : 'pre';
  elements.editor.style.overflowWrap = editor.lineWrap ? 'break-word' : 'normal';
  elements.editor.spellcheck = editor.spellcheck;
  elements.editor.style.tabSize = editor.tabSize;
  syncEditorHighlightLayout();

  marked.setOptions({
    gfm: true,
    breaks: markdown.breaks,
  });

  applySidebarCollapsed();
  updateAutoSaveTimer();
  updatePreview();
}

function clampSidebarWidth(width) {
  const max = Math.min(SIDEBAR_WIDTH_MAX, Math.floor(window.innerWidth * 0.5));
  const min = Math.min(SIDEBAR_WIDTH_MIN, max);
  const value = Number(width);
  if (!Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function applySidebarWidth(width) {
  const clamped = clampSidebarWidth(width);
  document.documentElement.style.setProperty('--sidebar-width', `${clamped}px`);
  if (state.settings?.sidebar && state.settings.sidebar.width !== clamped) {
    state.settings.sidebar.width = clamped;
  }
  return clamped;
}

function persistSidebarWidth(width) {
  const clamped = applySidebarWidth(width);
  if (!state.settings) return clamped;
  state.settings.sidebar.width = clamped;
  saveSettings();
  return clamped;
}

function initSidebarResize() {
  const handle = elements.sidebarResizeHandle;
  if (!handle) return;

  let dragging = false;
  let latestWidth = null;

  const onMove = (e) => {
    if (!dragging) return;
    const rect = elements.sidebar.getBoundingClientRect();
    latestWidth = applySidebarWidth(e.clientX - rect.left);
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('sidebar-resizing');
    elements.sidebar.classList.remove('resizing');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (latestWidth != null) persistSidebarWidth(latestWidth);
    latestWidth = null;
  };

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (!state.currentFolderPath || state.settings.sidebar.collapsed) return;
    e.preventDefault();
    dragging = true;
    latestWidth = state.settings.sidebar.width;
    document.body.classList.add('sidebar-resizing');
    elements.sidebar.classList.add('resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  handle.addEventListener('dblclick', (e) => {
    e.preventDefault();
    persistSidebarWidth(SIDEBAR_WIDTH_DEFAULT);
  });

  window.addEventListener('resize', () => {
    if (!state.settings?.sidebar) return;
    persistSidebarWidth(state.settings.sidebar.width);
  });
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
function canSave() {
  if (state.fileMissing) return false;
  if (!state.currentFilePath) return state.isDirty || Boolean(state.content);
  return state.isDirty;
}

function setDirty(dirty) {
  state.isDirty = dirty;
  elements.btnSave.disabled = !canSave();
  updateStatus();
  updateAutoSaveTimer();
}

function updateStatus() {
  document.body.classList.toggle('file-open', !!state.currentFilePath || state.content !== '' || !elements.editorPane.classList.contains('hidden'));

  if (!state.currentFilePath && elements.editorPane.classList.contains('hidden')) {
    elements.statusFile.textContent = 'No file open';
    elements.statusStats.textContent = '';
    return;
  }

  if (!state.currentFilePath) {
    let label = 'Untitled';
    if (state.isDirty) label += '  •  Unsaved';
    elements.statusFile.textContent = label;
  } else {
    const name = state.currentFilePath.split(/[/\\]/).pop();
    let label = name;
    if (state.fileMissing) label += '  •  File deleted';
    else if (state.isDirty) label += '  •  Unsaved';
    elements.statusFile.textContent = label;
  }

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
  if (state.renamingPath) return;
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

function getSortedFilteredItems() {
  const query = state.fileListFilter.trim().toLowerCase();
  const tagFilter = state.tagFilter;
  const sortBy = state.settings?.sidebar?.sortBy || 'name';
  const direction = state.settings?.sidebar?.sortDirection === 'desc' ? -1 : 1;

  let items = state.folderItems.slice();

  if (query) {
    items = items.filter((item) => item.name.toLowerCase().includes(query));
  }
  if (tagFilter.length) {
    items = items.filter((item) => tagFilter.some((tag) => (item.tags || []).includes(tag)));
  }

  const lastOpened = state.lastOpened;

  items.sort((a, b) => {
    const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pinDiff !== 0) return pinDiff;

    let cmp = 0;
    if (sortBy === 'lastOpened') {
      const ao = lastOpened[a.path] || 0;
      const bo = lastOpened[b.path] || 0;
      cmp = ao - bo;
      if (cmp === 0) cmp = a.name.localeCompare(b.name);
    } else if (sortBy === 'modified') {
      cmp = (a.mtime || 0) - (b.mtime || 0);
    } else if (sortBy === 'created') {
      cmp = (a.birthtime || 0) - (b.birthtime || 0);
    } else if (sortBy === 'size') {
      cmp = (a.size || 0) - (b.size || 0);
    } else if (sortBy === 'pinned') {
      cmp = a.name.localeCompare(b.name);
    } else {
      cmp = a.name.localeCompare(b.name);
    }

    if (sortBy === 'lastOpened' || sortBy === 'modified' || sortBy === 'created' || sortBy === 'size') {
      // default newest/largest first feels natural for these; direction flips it
      return -cmp * direction;
    }
    return cmp * direction;
  });

  return items;
}

function collectFolderTags() {
  const tags = new Set();
  state.folderItems.forEach((item) => {
    (item.tags || []).forEach((tag) => tags.add(tag));
  });
  Object.keys(state.settings?.tags?.catalog || {}).forEach((tag) => tags.add(tag));
  return [...tags].sort((a, b) => a.localeCompare(b));
}

function renderTagFilter() {
  if (!elements.tagFilter) return;
  const chipsHost = elements.tagFilterChips || elements.tagFilter;
  const tags = collectFolderTags();
  if (!tags.length || !state.currentFolderPath) {
    elements.tagFilter.classList.add('hidden');
    chipsHost.innerHTML = '';
    return;
  }

  elements.tagFilter.classList.remove('hidden');
  chipsHost.innerHTML = '';
  tags.forEach((tag) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-filter-chip' + (state.tagFilter.includes(tag) ? ' active' : '');
    btn.textContent = tag;
    btn.title = tag;
    const color = getTagColor(tag);
    if (state.tagFilter.includes(tag)) {
      btn.style.background = color;
      btn.style.color = '#fff';
    } else {
      btn.style.borderColor = color;
      btn.style.color = color;
    }
    btn.addEventListener('click', () => {
      if (state.tagFilter.includes(tag)) {
        state.tagFilter = state.tagFilter.filter((t) => t !== tag);
      } else {
        state.tagFilter = [...state.tagFilter, tag];
      }
      renderTagFilter();
      renderFileList();
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showTagFilterContextMenu(tag, e);
    });
    chipsHost.appendChild(btn);
  });
}

async function showTagFilterContextMenu(tag, event) {
  try {
    const result = await window.api.showTagContextMenu({
      tag,
      x: event.x,
      y: event.y,
    });
    if (result?.action === 'remove' && result.tag) {
      await deleteTagEverywhere(result.tag);
    }
  } catch (err) {
    console.error('Tag context menu failed:', err);
  }
}

async function deleteTagEverywhere(tagName) {
  if (!tagName) return;

  const filesWithTag = state.folderItems.filter((item) => (item.tags || []).includes(tagName));
  try {
    await Promise.all(
      filesWithTag.map(async (item) => {
        const tags = (item.tags || []).filter((t) => t !== tagName);
        const result = await window.api.updateFileMeta({ filePath: item.path, tags });
        item.tags = result.tags;
        item.pinned = result.pinned;
      }),
    );
  } catch (err) {
    alert(`Could not remove tag:\n${err.message}`);
    return;
  }

  if (state.settings?.tags?.catalog?.[tagName]) {
    delete state.settings.tags.catalog[tagName];
    saveSettings();
  }

  state.tagFilter = state.tagFilter.filter((t) => t !== tagName);
  renderTagFilter();
  renderFileList();
}

function closeTagPopover() {
  state.tagPopoverPath = null;
  elements.tagPopover.classList.add('hidden');
  elements.tagPopoverInput.value = '';
  elements.tagPopoverSuggestions.innerHTML = '';
}

function openTagPopover(filePath, anchorEl) {
  if (!filePath) return;
  state.tagPopoverPath = filePath;
  const rect = anchorEl.getBoundingClientRect();
  elements.tagPopover.classList.remove('hidden');
  const left = Math.min(rect.left, window.innerWidth - 240);
  const top = Math.min(rect.bottom + 6, window.innerHeight - 220);
  elements.tagPopover.style.left = `${Math.max(8, left)}px`;
  elements.tagPopover.style.top = `${Math.max(8, top)}px`;
  elements.tagPopoverInput.value = '';
  renderTagSuggestions();
  elements.tagPopoverInput.focus();
}

function renderTagSuggestions() {
  const query = elements.tagPopoverInput.value.trim().toLowerCase();
  const item = state.folderItems.find((f) => f.path === state.tagPopoverPath);
  const existing = new Set(item?.tags || []);
  const catalog = collectFolderTags().filter((tag) => !existing.has(tag));
  const filtered = catalog.filter((tag) => !query || tag.toLowerCase().includes(query));

  elements.tagPopoverSuggestions.innerHTML = '';
  filtered.forEach((tag) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-popover-item';
    btn.innerHTML = `<span class="tag-popover-swatch" style="background:${getTagColor(tag)}"></span><span></span>`;
    btn.querySelector('span:last-child').textContent = tag;
    btn.addEventListener('click', () => addTagToFile(state.tagPopoverPath, tag));
    elements.tagPopoverSuggestions.appendChild(btn);
  });

  if (query && !catalog.some((t) => t.toLowerCase() === query) && !existing.has(elements.tagPopoverInput.value.trim())) {
    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'tag-popover-item';
    const name = elements.tagPopoverInput.value.trim();
    createBtn.innerHTML = `<span class="tag-popover-swatch" style="background:${getTagColor(name)}"></span><span></span>`;
    createBtn.querySelector('span:last-child').textContent = `Create “${name}”`;
    createBtn.addEventListener('click', () => addTagToFile(state.tagPopoverPath, name));
    elements.tagPopoverSuggestions.prepend(createBtn);
  }
}

async function addTagToFile(filePath, tagName) {
  const name = String(tagName || '').trim();
  if (!filePath || !name) return;
  const item = state.folderItems.find((f) => f.path === filePath);
  const tags = [...new Set([...(item?.tags || []), name])];
  ensureTagInCatalog(name);
  try {
    const result = await window.api.updateFileMeta({ filePath, tags });
    if (item) {
      item.tags = result.tags;
      item.pinned = result.pinned;
    }
    closeTagPopover();
    renderTagFilter();
    renderFileList();
  } catch (err) {
    alert(`Could not add tag:\n${err.message}`);
  }
}

async function removeTagFromFile(filePath, tagName) {
  const item = state.folderItems.find((f) => f.path === filePath);
  if (!item) return;
  const tags = (item.tags || []).filter((t) => t !== tagName);
  try {
    const result = await window.api.updateFileMeta({ filePath, tags });
    item.tags = result.tags;
    item.pinned = result.pinned;
    renderTagFilter();
    renderFileList();
  } catch (err) {
    alert(`Could not remove tag:\n${err.message}`);
  }
}

async function togglePin(filePath) {
  const item = state.folderItems.find((f) => f.path === filePath);
  if (!item && filePath !== state.currentFilePath) return;
  const pinned = !(item?.pinned);
  try {
    const result = await window.api.updateFileMeta({ filePath, pinned });
    if (item) {
      item.pinned = result.pinned;
      item.tags = result.tags;
    }
    renderFileList();
  } catch (err) {
    alert(`Could not update pin:\n${err.message}`);
  }
}

function togglePinCurrent() {
  if (!state.currentFilePath || !state.currentFolderPath) return;
  togglePin(state.currentFilePath);
}

function openAddTagForFile(filePath, anchorEl) {
  if (!filePath || !state.currentFolderPath) return;
  const li = findFileListItem(filePath);
  const anchor = anchorEl || li?.querySelector('.btn-add-tag') || li || elements.btnNewFile;
  openTagPopover(filePath, anchor);
}

function openAddTagForCurrent() {
  if (!state.currentFilePath) return;
  openAddTagForFile(state.currentFilePath);
}

async function showFileContextMenu(item, event) {
  event.preventDefault();
  event.stopPropagation();
  closeTagPopover();

  try {
    const result = await window.api.showFileContextMenu({
      filePath: item.path,
      pinned: Boolean(item.pinned),
      tags: item.tags || [],
      x: event.x,
      y: event.y,
    });
    if (!result?.action) return;

    if (result.action === 'pin') {
      await togglePin(item.path);
    } else if (result.action === 'rename') {
      startRename(item.path);
    } else if (result.action === 'add-tag') {
      const li = findFileListItem(item.path);
      openAddTagForFile(item.path, li || elements.fileList);
    } else if (result.action === 'remove-tag' && result.tag) {
      await removeTagFromFile(item.path, result.tag);
    }
  } catch (err) {
    console.error('Context menu failed:', err);
  }
}

function renderFileList() {
  if (state.renamingPath) {
    const activeInput = elements.fileList.querySelector('.file-name-input');
    if (activeInput && document.activeElement === activeInput) return;
  }

  elements.fileList.innerHTML = '';
  const items = getSortedFilteredItems();

  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.dataset.path = item.path;
    li.title = item.name;
    li.style.animationDelay = `${Math.min(index * 25, 400)}ms`;
    if (item.pinned) li.classList.add('pinned');
    if (item.path === state.currentFilePath) li.classList.add('active');

    const row = document.createElement('div');
    row.className = 'file-row';
    row.innerHTML = FILE_ICON;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = item.name;
    row.appendChild(nameSpan);

    const actions = document.createElement('div');
    actions.className = 'file-row-actions';

    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'btn-pin';
    pinBtn.title = item.pinned ? `Unpin (${MOD_SHIFT}P)` : `Pin (${MOD_SHIFT}P)`;
    pinBtn.innerHTML = PIN_ICON;
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePin(item.path);
    });

    const tagBtn = document.createElement('button');
    tagBtn.type = 'button';
    tagBtn.className = 'btn-add-tag';
    tagBtn.title = `Add tag (${MOD_KEY}E)`;
    tagBtn.innerHTML = TAG_PLUS_ICON;
    tagBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTagPopover(item.path, tagBtn);
    });

    actions.appendChild(pinBtn);
    actions.appendChild(tagBtn);
    row.appendChild(actions);
    li.appendChild(row);

    if ((item.tags || []).length) {
      const tagsEl = document.createElement('div');
      tagsEl.className = 'file-tags';
      item.tags.forEach((tag) => {
        const chip = document.createElement('span');
        chip.className = 'file-tag-chip';
        chip.textContent = tag;
        chip.title = tag;
        chip.style.background = getTagColor(tag);
        tagsEl.appendChild(chip);
      });
      li.appendChild(tagsEl);
    }

    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename(item.path);
    });

    li.addEventListener('click', () => selectFile(item.path));
    li.addEventListener('contextmenu', (e) => showFileContextMenu(item, e));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'F2' || e.key === 'Enter') {
        if (document.activeElement === li) {
          e.preventDefault();
          startRename(item.path);
        }
      }
    });
    li.tabIndex = 0;

    elements.fileList.appendChild(li);
  });

  const showEmpty = state.folderItems.length > 0 && items.length === 0;
  elements.fileListEmpty.classList.toggle('hidden', !showEmpty);
  renderTagFilter();
}

function findFileListItem(filePath) {
  return [...elements.fileList.querySelectorAll('li')].find((li) => li.dataset.path === filePath) || null;
}

function startRename(filePath) {
  if (!filePath || !state.currentFolderPath) return;
  const item = state.folderItems.find((f) => f.path === filePath);
  if (!item) return;

  state.renamingPath = filePath;
  const li = findFileListItem(filePath);
  if (!li) {
    state.renamingPath = null;
    return;
  }
  const nameSpan = li.querySelector('.file-name');
  if (!nameSpan) {
    state.renamingPath = null;
    return;
  }

  const input = document.createElement('input');
  input.className = 'file-name-input';
  input.value = item.name;
  input.spellcheck = false;
  nameSpan.replaceWith(input);
  input.focus();
  const dot = item.name.lastIndexOf('.');
  input.setSelectionRange(0, dot > 0 ? dot : item.name.length);

  let finished = false;
  const finish = async (commit) => {
    if (finished) return;
    finished = true;
    state.renamingPath = null;
    if (!commit) {
      renderFileList();
      return;
    }
    const nextName = input.value.trim();
    if (!nextName || nextName === item.name) {
      renderFileList();
      return;
    }
    try {
      const result = await window.api.renameFile({ oldPath: filePath, newName: nextName });
      if (state.currentFilePath === filePath) {
        state.currentFilePath = result.filePath;
      }
      if (state.lastOpened[filePath]) {
        state.lastOpened[result.filePath] = state.lastOpened[filePath];
        delete state.lastOpened[filePath];
        saveLastOpened();
      }
      updateRecentPath(filePath, result.filePath, result.fileName);
      await refreshFolderList();
      updateStatus();
    } catch (err) {
      alert(`Could not rename file:\n${err.message}`);
      renderFileList();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
}

function renameCurrentFile() {
  if (!state.currentFilePath || !state.currentFolderPath) return;
  startRename(state.currentFilePath);
}

function updateActiveFile() {
  elements.fileList.querySelectorAll('li').forEach((li) => {
    li.classList.toggle('active', li.dataset.path === state.currentFilePath);
  });
}

function syncSortControls() {
  if (!elements.fileListSort || !state.settings) return;
  elements.fileListSort.value = state.settings.sidebar.sortBy || 'name';
  const desc = state.settings.sidebar.sortDirection === 'desc';
  elements.btnSortDirection.title = desc ? 'Sort ascending' : 'Sort descending';
  elements.btnSortDirection.setAttribute('aria-label', elements.btnSortDirection.title);

  const icon = document.getElementById('sort-direction-icon');
  if (icon) {
    icon.innerHTML = desc
      ? '<path d="M12 19V5M7 10l5-5 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<path d="M12 5v14M7 14l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
  }
}

async function showSidebar(folderPath, folderName, items) {
  await stopFolderWatch();
  state.currentFolderPath = folderPath;
  state.folderItems = items;
  state.fileListFilter = '';
  state.tagFilter = [];
  elements.fileListSearch.value = '';
  elements.folderName.textContent = folderName;
  elements.sidebar.classList.remove('hidden');
  syncSortControls();
  updateSidebarToggleState();
  renderFileList();
  recordRecent({ path: folderPath, type: 'folder', name: folderName });
  await startFolderWatch(folderPath);
}

async function hideSidebar() {
  await stopFolderWatch();
  closeTagPopover();
  state.currentFolderPath = null;
  state.folderItems = [];
  state.fileListFilter = '';
  state.tagFilter = [];
  elements.fileListSearch.value = '';
  elements.sidebar.classList.add('hidden');
  elements.fileList.innerHTML = '';
  elements.fileListEmpty.classList.add('hidden');
  if (elements.tagFilter) {
    elements.tagFilter.classList.add('hidden');
    if (elements.tagFilterChips) elements.tagFilterChips.innerHTML = '';
  }
  updateSidebarToggleState();
}

async function loadFile(filePath, content, { recordFileRecent = false } = {}) {
  state.currentFilePath = filePath;
  state.content = content;
  state.fileMissing = false;
  elements.editor.value = content;
  setDirty(false);
  showWorkspace();
  updatePreview();
  updateActiveFile();
  if (filePath) {
    recordLastOpened(filePath);
    if (recordFileRecent) {
      recordRecent({ path: filePath, type: 'file', name: basenamePath(filePath) });
    }
  }
}

async function openUntitledBuffer() {
  closeFindBar();
  closeTagPopover();
  state.currentFilePath = null;
  state.content = '';
  state.fileMissing = false;
  elements.editor.value = '';
  setDirty(false);
  showWorkspace();
  setMode('edit');
  updatePreview();
  updateActiveFile();
  updateStatus();
  elements.editor.focus();
}

async function createNewFile() {
  if (state.currentFolderPath) {
    if (state.isDirty && !confirm('You have unsaved changes. Continue without saving?')) return;
    try {
      const result = await window.api.createFile({
        folderPath: state.currentFolderPath,
        preferredName: 'Unnamed.md',
      });
      await refreshFolderList();
      await loadFile(result.filePath, result.content);
      setMode('edit');
      elements.editor.focus();
      startRename(result.filePath);
    } catch (err) {
      alert(`Could not create file:\n${err.message}`);
    }
    return;
  }

  if (state.currentFilePath && state.isDirty) {
    try {
      await window.api.saveFile(state.currentFilePath, state.content);
      setDirty(false);
    } catch (err) {
      alert(`Could not save file:\n${err.message}`);
      return;
    }
  } else if (!state.currentFilePath && state.isDirty) {
    if (!confirm('Discard unsaved untitled file?')) return;
  }

  await openUntitledBuffer();
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
    await loadFile(result.filePath, result.content, { recordFileRecent: true });
  } catch (err) {
    alert(`Could not open file:\n${err.message}`);
  }
}

async function selectFile(filePath) {
  if (filePath === state.currentFilePath) return;
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
    await loadFile(result.filePath, result.content, { recordFileRecent: true });
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

    const firstFile = getSortedFilteredItems().find((item) => item.type === 'file');
    if (firstFile) {
      await selectFile(firstFile.path);
    } else {
      showEmptyWorkspace();
    }
  } catch (err) {
    alert(`Could not open folder:\n${err.message}`);
  }
}

async function saveFileAs() {
  const hasBuffer = state.currentFilePath || !elements.editorPane.classList.contains('hidden');
  if (!hasBuffer && !state.content) return;

  try {
    const defaultPath = state.currentFilePath
      || (state.currentFolderPath ? `${state.currentFolderPath}/Unnamed.md` : 'Unnamed.md');
    const result = await window.api.saveFileDialog({
      content: state.content,
      defaultPath,
    });
    if (!result) return;
    await loadFile(result.filePath, result.content, { recordFileRecent: true });
    if (state.currentFolderPath) await refreshFolderList();
  } catch (err) {
    alert(`Could not save file:\n${err.message}`);
  }
}

async function saveFile({ silent = false } = {}) {
  if (!state.currentFilePath) {
    if (!silent) await saveFileAs();
    return;
  }
  if (!state.isDirty && !state.fileMissing) return;
  try {
    await window.api.saveFile(state.currentFilePath, state.content);
    setDirty(false);
    state.fileMissing = false;
    updateStatus();
    if (state.currentFolderPath) await refreshFolderList();
  } catch (err) {
    if (!silent) alert(`Could not save file:\n${err.message}`);
  }
}

function closeFile() {
  const hasOpenBuffer = state.currentFilePath || !elements.editorPane.classList.contains('hidden');
  if (!hasOpenBuffer) return;
  if (state.isDirty && !confirm('You have unsaved changes. Close without saving?')) return;

  closeFindBar();
  closeTagPopover();
  state.currentFilePath = null;
  state.content = '';
  state.fileMissing = false;
  elements.editor.value = '';
  elements.preview.innerHTML = '';
  showEmptyWorkspace();
  updateActiveFile();
  setDirty(false);
}

function showEmptyWorkspace() {
  elements.emptyState.classList.remove('hidden');
  elements.editorPane.classList.add('hidden');
  elements.previewPane.classList.add('hidden');
  state.currentFilePath = null;
  state.content = '';
  elements.editor.value = '';
  elements.preview.innerHTML = '';
  setDirty(false);
  renderEmptyRecents();
}

function renderEmptyRecents() {
  if (!elements.emptyRecents) return;

  const folders = state.recents
    .filter((item) => item.type === 'folder')
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, RECENTS_MAX_PER_TYPE);
  const files = state.recents
    .filter((item) => item.type === 'file')
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, RECENTS_MAX_PER_TYPE);

  const fillList = (listEl, sectionEl, items, type) => {
    listEl.innerHTML = '';
    if (!items.length) {
      sectionEl.classList.add('hidden');
      return;
    }
    sectionEl.classList.remove('hidden');
    items.forEach((item) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'empty-recent-item';
      btn.title = item.path;
      btn.innerHTML = `${type === 'folder' ? FOLDER_ICON : RECENT_FILE_ICON}<span class="recent-name"></span><span class="recent-time"></span>`;
      btn.querySelector('.recent-name').textContent = item.name || basenamePath(item.path);
      btn.querySelector('.recent-time').textContent = formatRelativeTime(item.openedAt);
      btn.addEventListener('click', () => openRecentItem(item));
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  };

  fillList(elements.emptyRecentFoldersList, elements.emptyRecentFolders, folders, 'folder');
  fillList(elements.emptyRecentFilesList, elements.emptyRecentFiles, files, 'file');

  const hasAny = folders.length > 0 || files.length > 0;
  elements.emptyRecents.classList.toggle('hidden', !hasAny);
}

async function openRecentItem(item) {
  if (!item?.path) return;

  try {
    const info = await window.api.pathExists(item.path);
    if (!info.exists || (item.type === 'folder' && !info.isDirectory) || (item.type === 'file' && !info.isFile)) {
      alert(`This ${item.type} no longer exists:\n${item.path}`);
      removeRecent(item.path, item.type);
      return;
    }
  } catch {
    /* continue and let open fail naturally */
  }

  if (item.type === 'folder') {
    await openFolderFromPath(item.path);
  } else {
    await openFileFromPath(item.path);
  }
}

async function openFolderFromPath(folderPath) {
  if (state.isDirty && !confirm('You have unsaved changes. Continue without saving?')) return;
  try {
    const items = await window.api.listFolder(folderPath);
    const folderName = basenamePath(folderPath);
    await showSidebar(folderPath, folderName, items);

    const firstFile = getSortedFilteredItems().find((entry) => entry.type === 'file');
    if (firstFile) {
      await selectFile(firstFile.path);
    } else {
      showEmptyWorkspace();
    }
  } catch (err) {
    alert(`Could not open folder:\n${err.message}`);
    removeRecent(folderPath, 'folder');
  }
}

/* ---------- File list search / sort ---------- */
function initFileListSearch() {
  elements.fileListSearch.addEventListener('input', () => {
    state.fileListFilter = elements.fileListSearch.value;
    renderFileList();
  });
}

function initSidebarSort() {
  elements.fileListSort.addEventListener('change', () => {
    updateSetting('sidebar.sortBy', elements.fileListSort.value);
    renderFileList();
  });
  elements.btnSortDirection.addEventListener('click', () => {
    const next = state.settings.sidebar.sortDirection === 'asc' ? 'desc' : 'asc';
    updateSetting('sidebar.sortDirection', next);
    syncSortControls();
    renderFileList();
  });
}

function focusFileFilter() {
  if (!state.currentFolderPath) return;
  if (state.settings.sidebar.collapsed) {
    updateSetting('sidebar.collapsed', false);
  }
  elements.fileListSearch.focus();
  elements.fileListSearch.select();
}

function initTagPopover() {
  elements.tagPopoverInput.addEventListener('input', renderTagSuggestions);
  elements.tagPopoverInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const name = elements.tagPopoverInput.value.trim();
      if (name) addTagToFile(state.tagPopoverPath, name);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeTagPopover();
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (elements.tagPopover.classList.contains('hidden')) return;
    if (elements.tagPopover.contains(e.target)) return;
    closeTagPopover();
  });
}

/* ---------- In-file find ---------- */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function syncEditorHighlightLayout() {
  const editor = elements.editor;
  const layer = elements.editorHighlights;
  if (!layer) return;

  // Match the textarea content box exactly. A wider overlay wraps differently
  // (scrollbar gutter / narrow split panes) and shifts highlights off the text.
  const style = getComputedStyle(editor);
  layer.style.boxSizing = style.boxSizing;
  layer.style.padding = style.padding;
  layer.style.border = style.border;
  layer.style.font = style.font;
  layer.style.fontFamily = style.fontFamily;
  layer.style.fontSize = style.fontSize;
  layer.style.fontWeight = style.fontWeight;
  layer.style.fontStyle = style.fontStyle;
  layer.style.lineHeight = style.lineHeight;
  layer.style.letterSpacing = style.letterSpacing;
  layer.style.wordSpacing = style.wordSpacing;
  layer.style.textAlign = style.textAlign;
  layer.style.textIndent = style.textIndent;
  layer.style.whiteSpace = style.whiteSpace;
  layer.style.overflowWrap = style.overflowWrap;
  layer.style.wordBreak = style.wordBreak;
  layer.style.tabSize = style.tabSize;
  layer.style.width = `${editor.clientWidth}px`;
  layer.style.height = `${editor.clientHeight}px`;
}

function syncEditorHighlightScroll() {
  const layer = elements.editorHighlights;
  if (!layer) return;
  layer.scrollTop = elements.editor.scrollTop;
  layer.scrollLeft = elements.editor.scrollLeft;
}

function clearEditorHighlights() {
  if (!elements.editorHighlights) return;
  elements.editorHighlights.innerHTML = '';
}

function highlightEditorMatches() {
  const layer = elements.editorHighlights;
  if (!layer) return;

  const text = elements.editor.value;
  const query = state.findQuery.trim();
  if (!query || !state.findMatches.length) {
    clearEditorHighlights();
    return;
  }

  syncEditorHighlightLayout();

  let html = '';
  let lastIndex = 0;
  state.findMatches.forEach((match, index) => {
    html += escapeHtml(text.slice(lastIndex, match.start));
    const cls = index === state.findIndex ? 'search-hit search-hit-current' : 'search-hit';
    html += `<mark class="${cls}">${escapeHtml(text.slice(match.start, match.end))}</mark>`;
    lastIndex = match.end;
  });
  html += escapeHtml(text.slice(lastIndex));
  // Trailing newline keeps height in sync with the textarea.
  layer.innerHTML = `${html}\n`;
  syncEditorHighlightLayout();
  syncEditorHighlightScroll();
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
  // Keep focus on the find input while searching; only move the selection/scroll.
  elements.editor.setSelectionRange(match.start, match.end);
  scrollTextareaToSelection(elements.editor);
  syncEditorHighlightScroll();
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
    clearEditorHighlights();
    return;
  }

  if (state.mode === 'view') {
    clearEditorHighlights();
    highlightPreviewMatches();
    if (state.findMatches.length) scrollToPreviewMatch(state.findIndex);
    return;
  }

  // Edit and split: search/highlight only in the editor.
  clearPreviewHighlights();
  highlightEditorMatches();
  if (state.findMatches.length) scrollEditorToMatch(state.findIndex);
}

function openFindBar() {
  if (!state.currentFilePath && elements.editorPane.classList.contains('hidden')) return;
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
  clearEditorHighlights();
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

  if (state.mode === 'view') {
    highlightPreviewMatches();
    scrollToPreviewMatch(state.findIndex);
    return;
  }

  // Edit and split: navigate matches only in the editor.
  highlightEditorMatches();
  scrollEditorToMatch(state.findIndex);
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
  elements.editor.addEventListener('scroll', () => {
    syncEditorHighlightScroll();
    scheduleSplitScrollSync();
  });

  if (typeof ResizeObserver !== 'undefined') {
    const scheduleHighlightRelayout = debounce(() => {
      if (elements.findBar.classList.contains('hidden')) return;
      if (state.mode !== 'edit' && state.mode !== 'split') return;
      if (!state.findQuery.trim()) return;
      highlightEditorMatches();
    }, 50);
    new ResizeObserver(scheduleHighlightRelayout).observe(elements.editor);
  }

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
  ['#btn-new-file', '#btn-new-file-top', '#empty-new-file'].forEach((sel) => {
    const el = $(sel);
    if (el) el.addEventListener('click', createNewFile);
  });
  elements.btnSave.addEventListener('click', () => saveFile());
  elements.btnClose.addEventListener('click', closeFile);
  elements.btnToggleSidebar.addEventListener('click', toggleSidebar);
  elements.btnRefreshFolder.addEventListener('click', refreshFolderList);
}

function initMenuShortcuts() {
  window.api.onMenuNewFile(() => createNewFile());
  window.api.onMenuOpenFile(() => openFile());
  window.api.onMenuOpenFolder(() => openFolder());
  window.api.onMenuSave(() => saveFile());
  window.api.onMenuSaveAs(() => saveFileAs());
  window.api.onMenuCloseFile(() => closeFile());
  window.api.onMenuRenameFile(() => renameCurrentFile());
  window.api.onMenuTogglePin(() => togglePinCurrent());
  window.api.onMenuAddTag(() => openAddTagForCurrent());
  window.api.onMenuToggleSidebar(() => toggleSidebar());
  window.api.onMenuFind(() => openFindBar());
  window.api.onMenuFocusFilter(() => focusFileFilter());
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

  const titles = [
    ['#btn-toggle-sidebar', `Toggle sidebar (${MOD_KEY}B)`],
    ['#btn-open-file', `Open file (${MOD_KEY}O)`],
    ['#btn-open-folder', `Open folder (${MOD_SHIFT}O)`],
    ['#btn-close', `Close file (${MOD_KEY}W)`],
    ['#btn-save', `Save (${MOD_KEY}S)`],
    ['#btn-settings', `Settings (${MOD_KEY},)`],
    ['#btn-new-file', `New file (${MOD_KEY}T)`],
    ['#btn-new-file-top', `New file (${MOD_KEY}T)`],
  ];
  titles.forEach(([sel, title]) => {
    const el = $(sel);
    if (el) el.title = title;
  });
}

function initGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!elements.tagPopover.classList.contains('hidden')) {
        closeTagPopover();
        return;
      }
      if (state.tagFilter.length) {
        state.tagFilter = [];
        renderTagFilter();
        renderFileList();
      }
    }
  });
}

initPlatform();
initModeSwitch();
initEditor();
initButtons();
initFileListSearch();
initSidebarSort();
initSidebarResize();
initTagPopover();
initFindBar();
initMenuShortcuts();
initGlobalKeys();

initSettings()
  .then(() => {
    state.lastOpened = loadLastOpened();
    state.recents = loadRecents();
    syncSortControls();
    setMode(state.settings.markdown.defaultMode);
    updateStatus();
    updateSidebarToggleState();
    renderEmptyRecents();
  })
  .catch((err) => {
    console.error('Failed to initialize settings:', err);
    state.lastOpened = loadLastOpened();
    state.recents = loadRecents();
    setMode('view');
    updateStatus();
    updateSidebarToggleState();
    renderEmptyRecents();
  });
