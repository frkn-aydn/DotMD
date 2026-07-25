import {
  SETTINGS_KEY,
  DEFAULT_SETTINGS,
  VALID_THEMES,
  DARK_THEMES,
  LEGACY_FONT_KEYS,
  SYSTEM_FONT_DEFAULT,
  PREVIEW_FONT_FALLBACK,
  EDITOR_FONT_FALLBACK,
  SIDEBAR_WIDTH_DEFAULT,
  TAG_PALETTE,
} from './constants.js';
import { state, elements } from './state.js';
import { cssFontFamily } from './utils.js';
import { applySidebarCollapsed, applySidebarWidth } from './sidebar.js';
import { syncEditorHighlightLayout, ensureAutoSaveTimer } from './editor.js';
import { updatePreview, resetEditorMirrorText } from './preview.js';

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

export function populateFontSelects() {
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

export function applySystemFonts(fonts) {
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

export function loadSettings() {
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

export function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

export function getTagColor(tagName) {
  const entry = state.settings?.tags?.catalog?.[tagName];
  if (entry?.color) return entry.color;
  let hash = 0;
  for (let i = 0; i < tagName.length; i += 1) {
    hash = (hash * 31 + tagName.charCodeAt(i)) >>> 0;
  }
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

export function ensureTagInCatalog(tagName) {
  if (!state.settings.tags.catalog[tagName]) {
    const used = new Set(Object.values(state.settings.tags.catalog).map((t) => t.color));
    const color = TAG_PALETTE.find((c) => !used.has(c)) || TAG_PALETTE[Object.keys(state.settings.tags.catalog).length % TAG_PALETTE.length];
    state.settings.tags.catalog[tagName] = { color };
    saveSettings();
  }
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

export function applySettings() {
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

  if (state.preferredSidebarWidth == null || !Number.isFinite(state.preferredSidebarWidth)) {
    state.preferredSidebarWidth = sidebar.width || SIDEBAR_WIDTH_DEFAULT;
  }
  applySidebarWidth(state.preferredSidebarWidth);

  elements.editor.style.whiteSpace = editor.lineWrap ? 'pre-wrap' : 'pre';
  elements.editor.style.overflowWrap = editor.lineWrap ? 'break-word' : 'normal';
  elements.editor.spellcheck = editor.spellcheck;
  elements.editor.style.tabSize = editor.tabSize;
  resetEditorMirrorText();
  syncEditorHighlightLayout({ force: true });

  marked.setOptions({
    gfm: true,
    breaks: markdown.breaks,
  });

  applySidebarCollapsed();
  ensureAutoSaveTimer();
  if (state.mode === 'edit') state.previewStale = true;
  else updatePreview();
}

export function updateSetting(path, value) {
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

export function openSettings() {
  syncSettingsForm();
  elements.settingsOverlay.classList.remove('hidden');
  elements.settingsOverlay.setAttribute('aria-hidden', 'false');
  ensureFontSelectsReady();
}

function closeSettings() {
  elements.settingsOverlay.classList.add('hidden');
  elements.settingsOverlay.setAttribute('aria-hidden', 'true');
}

export async function initSettings() {
  state.settings = loadSettings();
  state.preferredSidebarWidth = state.settings.sidebar.width || SIDEBAR_WIDTH_DEFAULT;
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
    el.addEventListener('change', async () => {
      let value = type === 'checkbox' ? el.checked : el.value;
      if (type === 'number' || type === 'float') {
        value = type === 'float' ? parseFloat(value) : parseInt(value, 10);
        if (Number.isNaN(value)) return;
      }
      updateSetting(path, value);

      if (path === 'files.autoRefresh' && state.currentFolderPath) {
        if (value) {
          const { startFolderWatch } = await import('./workspace.js');
          startFolderWatch(state.currentFolderPath);
        } else {
          window.api.unwatchFolder();
        }
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
