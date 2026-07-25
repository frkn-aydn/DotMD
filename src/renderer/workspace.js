import {
  LAST_OPENED_KEY,
  LAST_OPENED_MAX,
  RECENTS_KEY,
  RECENTS_MAX_PER_TYPE,
  FOLDER_ICON,
  RECENT_FILE_ICON,
} from './constants.js';
import { state, elements } from './state.js';
import {
  confirmDiscardChanges,
  showConfirm,
  showAlert,
  basenamePath,
  formatRelativeTime,
} from './utils.js';
import {
  showSidebar,
  hideSidebar,
  getSortedFilteredItems,
  renderFileList,
  updateActiveFile,
  startRename,
  closeTagPopover,
  toggleSidebar,
} from './sidebar.js';
import { setMode, updatePreview, resetEditorMirrorText } from './preview.js';
import { setDirty, canSave, updateStatus } from './editor.js';
import { closeFindBar } from './find.js';

export function loadLastOpened() {
  try {
    const raw = localStorage.getItem(LAST_OPENED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveLastOpened() {
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

export function loadRecents() {
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

export function recordRecent({ path: targetPath, type, name }) {
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

export function updateRecentPath(oldPath, newPath, newName) {
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

export function removeRecent(targetPath, type) {
  const before = state.recents.length;
  state.recents = state.recents.filter((item) => !(item.path === targetPath && (!type || item.type === type)));
  if (state.recents.length !== before) {
    saveRecents();
    renderEmptyRecents();
  }
}

export async function startFolderWatch(folderPath) {
  if (!state.settings.files.autoRefresh) return;
  await window.api.watchFolder(folderPath);
}

export async function stopFolderWatch() {
  await window.api.unwatchFolder();
}

export async function refreshFolderList() {
  if (!state.currentFolderPath) return;

  try {
    const items = await window.api.listFolder(state.currentFolderPath);
    applyFolderItems(items);
  } catch (err) {
    console.error('Could not refresh folder:', err);
  }
}

async function refreshFileMissingState() {
  if (!state.currentFilePath) {
    state.fileMissing = false;
    return;
  }
  try {
    const info = await window.api.pathExists(state.currentFilePath);
    state.fileMissing = !info.exists || !info.isFile;
  } catch {
    state.fileMissing = false;
  }
}

export function applyFolderItems(items) {
  if (state.renamingPath) {
    state.pendingFolderItems = items;
    return;
  }
  state.folderItems = items;
  state.pendingFolderItems = null;
  renderFileList();
  refreshFileMissingState().then(() => {
    updateStatus();
    elements.btnSave.disabled = !canSave();
  });
}

export function handleFolderChanged({ folderPath, items }) {
  if (folderPath !== state.currentFolderPath) return;
  applyFolderItems(items);
}

function patchFolderItemStats(filePath, { mtime, size } = {}) {
  const item = state.folderItems.find((entry) => entry.path === filePath);
  if (!item) return;
  if (mtime != null) item.mtime = mtime;
  if (size != null) item.size = size;
}

function showWorkspace() {
  elements.emptyState.classList.add('hidden');
  elements.editorPane.classList.remove('hidden');
  elements.previewPane.classList.remove('hidden');
  setMode(state.mode);
}

export async function loadFile(filePath, content, { recordFileRecent = false } = {}) {
  state.currentFilePath = filePath;
  state.content = content;
  state.fileMissing = false;
  state.autoSaveError = null;
  state.imageResolveCache.clear();
  resetEditorMirrorText();
  elements.editor.value = content;
  state.currentFileMtime = null;
  if (filePath) {
    try {
      const stat = await window.api.getFileStat(filePath);
      state.currentFileMtime = stat.exists ? stat.mtime : null;
      state.fileMissing = !stat.exists;
    } catch {
      state.currentFileMtime = null;
    }
  }
  setDirty(false);
  showWorkspace();
  state.previewStale = true;
  if (state.mode !== 'edit') updatePreview();
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

export async function createNewFile() {
  if (state.currentFolderPath) {
    if (!(await confirmDiscardChanges())) return;
    try {
      const result = await window.api.createFile({
        folderPath: state.currentFolderPath,
        preferredName: 'Unnamed.md',
      });
      await refreshFolderList();
      await loadFile(result.filePath, result.content);
      setMode('edit');
      startRename(result.filePath);
    } catch (err) {
      await showAlert('Could not create file', err.message);
    }
    return;
  }

  if (state.currentFilePath && state.isDirty) {
    const saved = await saveFile();
    if (saved === false) return;
  } else if (!state.currentFilePath && state.isDirty) {
    if (!(await showConfirm('Discard unsaved untitled file?'))) return;
  }

  await openUntitledBuffer();
}

export async function openFileFromPath(filePath) {
  if (!(await confirmDiscardChanges())) return;

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
    await showAlert('Could not open file', err.message);
  }
}

export async function selectFile(filePath) {
  if (state.renamingPath) return;
  if (filePath === state.currentFilePath) return;
  if (!(await confirmDiscardChanges())) return;
  try {
    const result = await window.api.readFile(filePath);
    await loadFile(result.filePath, result.content);
  } catch (err) {
    await showAlert('Could not open file', err.message);
  }
}

export async function openFile() {
  if (!(await confirmDiscardChanges())) return;
  try {
    const result = await window.api.openFileDialog();
    if (!result) return;
    await hideSidebar();
    await loadFile(result.filePath, result.content, { recordFileRecent: true });
  } catch (err) {
    await showAlert('Could not open file', err.message);
  }
}

export async function openFolder() {
  if (!(await confirmDiscardChanges())) return;
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
    await showAlert('Could not open folder', err.message);
  }
}

export async function saveFileAs() {
  const hasBuffer = state.currentFilePath || !elements.editorPane.classList.contains('hidden');
  if (!hasBuffer && !state.content) return false;

  try {
    const defaultPath = state.currentFilePath
      || (state.currentFolderPath ? `${state.currentFolderPath}/Unnamed.md` : 'Unnamed.md');
    const result = await window.api.saveFileDialog({
      content: state.content,
      defaultPath,
    });
    if (!result) return false;
    await loadFile(result.filePath, result.content, { recordFileRecent: true });
    return true;
  } catch (err) {
    await showAlert('Could not save file', err.message);
    return false;
  }
}

export async function saveFile({ silent = false, force = false } = {}) {
  if (!state.currentFilePath) {
    if (!silent) return saveFileAs();
    return false;
  }
  if (!state.isDirty && !state.fileMissing && !force) return true;

  try {
    const result = await window.api.saveFile(state.currentFilePath, state.content, {
      expectedMtime: force ? null : state.currentFileMtime,
    });

    if (result?.conflict) {
      if (silent) {
        state.autoSaveError = 'conflict';
        updateStatus();
        return false;
      }
      const overwrite = await showConfirm(
        'This file has changed on disk.',
        'Save anyway and overwrite the external changes?',
      );
      if (!overwrite) return false;
      return saveFile({ silent, force: true });
    }

    if (!result?.success) {
      throw new Error('Save failed');
    }

    state.currentFileMtime = result.mtime ?? state.currentFileMtime;
    state.fileMissing = false;
    state.autoSaveError = null;
    setDirty(false);
    patchFolderItemStats(state.currentFilePath, {
      mtime: result.mtime,
      size: result.size ?? state.content.length,
    });
    updateStatus();
    return true;
  } catch (err) {
    if (silent) {
      state.autoSaveError = err.message || 'error';
      updateStatus();
      return false;
    }
    await showAlert('Could not save file', err.message);
    return false;
  }
}

export async function closeFile() {
  const hasOpenBuffer = state.currentFilePath || !elements.editorPane.classList.contains('hidden');
  if (!hasOpenBuffer) return;
  if (!(await confirmDiscardChanges('Close without saving?'))) return;

  closeFindBar();
  closeTagPopover();
  state.currentFilePath = null;
  state.currentFileMtime = null;
  state.content = '';
  state.fileMissing = false;
  state.autoSaveError = null;
  elements.editor.value = '';
  elements.preview.innerHTML = '';
  showEmptyWorkspace();
  updateActiveFile();
  setDirty(false);
}

export function showEmptyWorkspace() {
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

export function renderEmptyRecents() {
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
      await showAlert(`This ${item.type} no longer exists`, item.path);
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
  if (!(await confirmDiscardChanges())) return;
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
    await showAlert('Could not open folder', err.message);
    removeRecent(folderPath, 'folder');
  }
}

export function initButtons() {
  const $ = (sel) => document.querySelector(sel);
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
