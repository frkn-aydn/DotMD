import { MOD_KEY, MOD_SHIFT } from './constants.js';
import { state, elements, initElements } from './state.js';
import { initSettings, populateFontSelects, applySystemFonts, openSettings } from './settings.js';
import { initEditor, updateStatus } from './editor.js';
import { initFindBar, openFindBar } from './find.js';
import { setMode, initPreviewLinks } from './preview.js';
import {
  initFileListSearch,
  initFileListDelegation,
  initSidebarSort,
  initSidebarResize,
  initTagPopover,
  toggleSidebar,
  renameCurrentFile,
  togglePinCurrent,
  openAddTagForCurrent,
  focusFileFilter,
  closeTagPopover,
  renderTagFilter,
  renderFileList,
  syncSortControls,
  updateSidebarToggleState,
} from './sidebar.js';
import {
  loadLastOpened,
  loadRecents,
  initButtons,
  openFile,
  openFolder,
  createNewFile,
  saveFile,
  saveFileAs,
  closeFile,
  openFileFromPath,
  handleFolderChanged,
  renderEmptyRecents,
} from './workspace.js';

function initModeSwitch() {
  elements.modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
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
  window.api.onFolderWatchError?.((payload) => {
    console.warn('Folder watch error:', payload?.folderPath);
  });
  window.api.onFontsUpdated((fonts) => {
    applySystemFonts(fonts);
    if (!elements.settingsOverlay.classList.contains('hidden')) {
      populateFontSelects();
    }
  });
  window.api.onRequestSaveBeforeQuit(async () => {
    try {
      const ok = await saveFile({ silent: false });
      if (ok === false) {
        await window.api.cancelQuit();
        return;
      }
      await window.api.confirmQuit();
    } catch {
      await window.api.cancelQuit();
    }
  });
}

function initPlatform() {
  document.body.setAttribute('data-platform', window.api.platform || 'other');

  const $ = (sel) => document.querySelector(sel);
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

initElements();
initPlatform();
initModeSwitch();
initEditor();
initPreviewLinks();
initButtons();
initFileListSearch();
initFileListDelegation();
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
