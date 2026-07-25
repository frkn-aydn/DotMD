export const SETTINGS_KEY = 'dotmd-settings';
export const LAST_OPENED_KEY = 'dotmd-last-opened';
export const LAST_OPENED_MAX = 500;
export const RECENTS_KEY = 'dotmd-recents';
export const RECENTS_MAX_PER_TYPE = 10;
export const SIDEBAR_WIDTH_DEFAULT = 268;
export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 480;

export const TAG_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

export const VALID_THEMES = [
  'system', 'light', 'dark', 'sepia', 'nord',
  'solarized-light', 'solarized-dark', 'dracula', 'gruvbox',
  'rose', 'forest', 'high-contrast',
];

export const DARK_THEMES = new Set([
  'dark', 'nord', 'solarized-dark', 'dracula', 'gruvbox', 'forest', 'high-contrast',
]);

export const DEFAULT_SETTINGS = {
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

export const FILE_LIST_WINDOW_THRESHOLD = 300;
export const FILE_LIST_ROW_ESTIMATE = 36;
export const FILE_LIST_OVERSCAN = 12;

export const FILE_ICON =
  '<svg class="file-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<path d="M14 3v5h5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

export const FOLDER_ICON =
  '<svg class="file-icon recent-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

export const RECENT_FILE_ICON =
  '<svg class="file-icon recent-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<path d="M14 3v5h5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

export const PIN_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M12 17v5M8 3l1.5 7H6l6 8 6-8h-3.5L16 3H8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

export const TAG_PLUS_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

export const SYSTEM_FONT_DEFAULT = '__system__';
export const PREVIEW_FONT_FALLBACK = 'system-ui, sans-serif';
export const EDITOR_FONT_FALLBACK = 'ui-monospace, monospace';

export const MOD_KEY = (window.api?.platform === 'darwin') ? '⌘' : 'Ctrl+';
export const MOD_SHIFT = (window.api?.platform === 'darwin') ? '⌘⇧' : 'Ctrl+Shift+';

export const LEGACY_FONT_KEYS = new Set([
  'sans', 'serif', 'mono', 'rounded',
  'palatino', 'charter', 'baskerville', 'humanist',
  'sf-mono', 'jetbrains', 'fira', 'source', 'cascadia', 'consolas', 'monaco',
]);
