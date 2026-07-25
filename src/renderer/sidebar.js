import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  FILE_LIST_WINDOW_THRESHOLD,
  FILE_LIST_ROW_ESTIMATE,
  FILE_LIST_OVERSCAN,
  FILE_ICON,
  PIN_ICON,
  TAG_PLUS_ICON,
  MOD_KEY,
  MOD_SHIFT,
} from './constants.js';
import { state, elements } from './state.js';
import { debounce, showAlert, nameCollator } from './utils.js';
import {
  updateSetting,
  saveSettings,
  getTagColor,
  ensureTagInCatalog,
} from './settings.js';
import { selectFile, refreshFolderList, applyFolderItems, saveLastOpened, updateRecentPath, startFolderWatch, stopFolderWatch, recordRecent } from './workspace.js';
import { updateStatus } from './editor.js';

export function clampSidebarWidth(width) {
  const max = Math.min(SIDEBAR_WIDTH_MAX, Math.floor(window.innerWidth * 0.5));
  const min = Math.min(SIDEBAR_WIDTH_MIN, max);
  const value = Number(width);
  if (!Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function applySidebarWidth(width, { persistPreferred = false } = {}) {
  const preferred = Number.isFinite(Number(width)) ? Math.round(Number(width)) : state.preferredSidebarWidth;
  if (persistPreferred) state.preferredSidebarWidth = preferred;
  const clamped = clampSidebarWidth(preferred);
  document.documentElement.style.setProperty('--sidebar-width', `${clamped}px`);
  if (state.settings?.sidebar) state.settings.sidebar.width = state.preferredSidebarWidth;
  return clamped;
}

export function persistSidebarWidth(width) {
  const clamped = applySidebarWidth(width, { persistPreferred: true });
  if (!state.settings) return clamped;
  state.settings.sidebar.width = state.preferredSidebarWidth;
  saveSettings();
  return clamped;
}

const debouncedWindowResizeSidebar = debounce(() => {
  if (!state.settings?.sidebar) return;
  applySidebarWidth(state.preferredSidebarWidth);
}, 150);

export function initSidebarResize() {
  const handle = elements.sidebarResizeHandle;
  if (!handle) return;

  let dragging = false;
  let latestWidth = null;

  const onMove = (e) => {
    if (!dragging) return;
    const rect = elements.sidebar.getBoundingClientRect();
    latestWidth = applySidebarWidth(e.clientX - rect.left, { persistPreferred: true });
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
    latestWidth = state.preferredSidebarWidth;
    document.body.classList.add('sidebar-resizing');
    elements.sidebar.classList.add('resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  handle.addEventListener('dblclick', (e) => {
    e.preventDefault();
    persistSidebarWidth(SIDEBAR_WIDTH_DEFAULT);
  });

  window.addEventListener('resize', debouncedWindowResizeSidebar);
}

export function applySidebarCollapsed() {
  const collapsed = state.settings.sidebar.collapsed;
  elements.sidebar.classList.toggle('collapsed', collapsed);
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  elements.btnToggleSidebar.classList.toggle('active', !collapsed && !!state.currentFolderPath);
}

export function toggleSidebar() {
  if (!state.currentFolderPath) return;
  updateSetting('sidebar.collapsed', !state.settings.sidebar.collapsed);
}

export function updateSidebarToggleState() {
  const hasFolder = !!state.currentFolderPath;
  elements.btnToggleSidebar.disabled = !hasFolder;
  document.body.classList.toggle('folder-open', hasFolder);
  applySidebarCollapsed();
}

export function getSortedFilteredItems() {
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
      if (cmp === 0) cmp = nameCollator.compare(a.name, b.name);
    } else if (sortBy === 'modified') {
      cmp = (a.mtime || 0) - (b.mtime || 0);
    } else if (sortBy === 'created') {
      cmp = (a.birthtime || 0) - (b.birthtime || 0);
    } else if (sortBy === 'size') {
      cmp = (a.size || 0) - (b.size || 0);
    } else if (sortBy === 'pinned') {
      cmp = nameCollator.compare(a.name, b.name);
    } else {
      cmp = nameCollator.compare(a.name, b.name);
    }

    if (sortBy === 'lastOpened' || sortBy === 'modified' || sortBy === 'created' || sortBy === 'size') {
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
  return [...tags].sort((a, b) => nameCollator.compare(a, b));
}

export function renderTagFilter() {
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
      showTagFilterContextMenu(tag);
    });
    chipsHost.appendChild(btn);
  });
}

async function showTagFilterContextMenu(tag) {
  try {
    const result = await window.api.showTagContextMenu({ tag });
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
    await showAlert('Could not remove tag', err.message);
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

export function closeTagPopover() {
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
    await showAlert('Could not add tag', err.message);
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
    await showAlert('Could not remove tag', err.message);
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
    await showAlert('Could not update pin', err.message);
  }
}

export function togglePinCurrent() {
  if (!state.currentFilePath || !state.currentFolderPath) return;
  togglePin(state.currentFilePath);
}

function openAddTagForFile(filePath, anchorEl) {
  if (!filePath || !state.currentFolderPath) return;
  const li = findFileListItem(filePath);
  const anchor = anchorEl || li?.querySelector('.btn-add-tag') || li || elements.btnNewFile;
  openTagPopover(filePath, anchor);
}

export function openAddTagForCurrent() {
  if (!state.currentFilePath) return;
  openAddTagForFile(state.currentFilePath);
}

async function showFileContextMenu(item) {
  closeTagPopover();
  state.contextTargetPath = item.path;
  const li = findFileListItem(item.path);
  if (li) li.classList.add('context-target');

  try {
    const result = await window.api.showFileContextMenu({
      filePath: item.path,
      pinned: Boolean(item.pinned),
      tags: item.tags || [],
    });
    if (!result?.action) return;

    if (result.action === 'pin') {
      await togglePin(item.path);
    } else if (result.action === 'rename') {
      startRename(item.path);
    } else if (result.action === 'add-tag') {
      openAddTagForFile(item.path, li || elements.fileList);
    } else if (result.action === 'remove-tag' && result.tag) {
      await removeTagFromFile(item.path, result.tag);
    }
  } catch (err) {
    console.error('Context menu failed:', err);
  } finally {
    state.contextTargetPath = null;
    elements.fileList.querySelectorAll('li.context-target').forEach((el) => {
      el.classList.remove('context-target');
    });
  }
}

function createFileListItem(item, index, { animate }) {
  const li = document.createElement('li');
  li.dataset.path = item.path;
  li.title = item.name;
  if (animate && index < 12) {
    li.style.animationDelay = `${index * 25}ms`;
    li.classList.add('animate-in');
  }
  if (item.pinned) li.classList.add('pinned');
  if (item.path === state.currentFilePath) li.classList.add('active');
  if (item.path === state.contextTargetPath) li.classList.add('context-target');

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
  pinBtn.dataset.action = 'pin';
  pinBtn.title = item.pinned ? `Unpin (${MOD_SHIFT}P)` : `Pin (${MOD_SHIFT}P)`;
  pinBtn.innerHTML = PIN_ICON;

  const tagBtn = document.createElement('button');
  tagBtn.type = 'button';
  tagBtn.className = 'btn-add-tag';
  tagBtn.dataset.action = 'add-tag';
  tagBtn.title = `Add tag (${MOD_KEY}E)`;
  tagBtn.innerHTML = TAG_PLUS_ICON;

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

  li.tabIndex = -1;
  return li;
}

function setFileListFocus(index, items) {
  const list = items || getSortedFilteredItems();
  if (!list.length) {
    state.fileListFocusIndex = -1;
    return;
  }
  const next = Math.max(0, Math.min(list.length - 1, index));
  state.fileListFocusIndex = next;
  const lis = elements.fileList.querySelectorAll('li[data-path]');
  lis.forEach((li) => {
    li.tabIndex = -1;
  });
  const focused = [...lis].find((li) => li.dataset.path === list[next].path);
  if (focused) {
    focused.tabIndex = 0;
    if (document.activeElement === elements.fileList || elements.fileList.contains(document.activeElement)) {
      focused.focus({ preventScroll: false });
    }
  }
}

export function renderFileList() {
  if (state.renamingPath) {
    const activeInput = elements.fileList.querySelector('.file-name-input');
    if (activeInput && document.activeElement === activeInput) return;
  }

  const items = getSortedFilteredItems();
  const animate = state.fileListAnimate;
  state.fileListAnimate = false;

  const useWindowing = items.length >= FILE_LIST_WINDOW_THRESHOLD;
  elements.fileList.classList.toggle('windowed', useWindowing);

  if (!useWindowing) {
    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => {
      fragment.appendChild(createFileListItem(item, index, { animate }));
    });
    elements.fileList.innerHTML = '';
    elements.fileList.appendChild(fragment);
  } else {
    const scrollTop = elements.fileList.scrollTop;
    const viewport = elements.fileList.clientHeight || 400;
    const start = Math.max(0, Math.floor(scrollTop / FILE_LIST_ROW_ESTIMATE) - FILE_LIST_OVERSCAN);
    const visibleCount = Math.ceil(viewport / FILE_LIST_ROW_ESTIMATE) + FILE_LIST_OVERSCAN * 2;
    const end = Math.min(items.length, start + visibleCount);
    const topPad = start * FILE_LIST_ROW_ESTIMATE;
    const bottomPad = Math.max(0, (items.length - end) * FILE_LIST_ROW_ESTIMATE);

    const fragment = document.createDocumentFragment();
    const topSpacer = document.createElement('li');
    topSpacer.className = 'file-list-spacer';
    topSpacer.style.height = `${topPad}px`;
    topSpacer.setAttribute('aria-hidden', 'true');
    fragment.appendChild(topSpacer);

    for (let i = start; i < end; i += 1) {
      fragment.appendChild(createFileListItem(items[i], i, { animate: false }));
    }

    const bottomSpacer = document.createElement('li');
    bottomSpacer.className = 'file-list-spacer';
    bottomSpacer.style.height = `${bottomPad}px`;
    bottomSpacer.setAttribute('aria-hidden', 'true');
    fragment.appendChild(bottomSpacer);

    elements.fileList.innerHTML = '';
    elements.fileList.appendChild(fragment);
    elements.fileList.scrollTop = scrollTop;
  }

  if (state.fileListFocusIndex >= items.length) state.fileListFocusIndex = items.length - 1;
  if (state.fileListFocusIndex < 0 && items.length) state.fileListFocusIndex = 0;
  setFileListFocus(state.fileListFocusIndex, items);

  const showEmpty = state.folderItems.length > 0 && items.length === 0;
  elements.fileListEmpty.classList.toggle('hidden', !showEmpty);
  renderTagFilter();
}

export function initFileListDelegation() {
  elements.fileList.addEventListener('click', (e) => {
    if (state.renamingPath) return;
    const actionBtn = e.target.closest('[data-action]');
    const li = e.target.closest('li[data-path]');
    if (!li) return;
    const filePath = li.dataset.path;

    if (actionBtn?.dataset.action === 'pin') {
      e.stopPropagation();
      togglePin(filePath);
      return;
    }
    if (actionBtn?.dataset.action === 'add-tag') {
      e.stopPropagation();
      openTagPopover(filePath, actionBtn);
      return;
    }
    selectFile(filePath);
  });

  elements.fileList.addEventListener('dblclick', (e) => {
    const nameEl = e.target.closest('.file-name');
    const li = e.target.closest('li[data-path]');
    if (!nameEl || !li) return;
    e.stopPropagation();
    startRename(li.dataset.path);
  });

  elements.fileList.addEventListener('contextmenu', (e) => {
    const li = e.target.closest('li[data-path]');
    if (!li) return;
    e.preventDefault();
    e.stopPropagation();
    const item = state.folderItems.find((f) => f.path === li.dataset.path);
    if (item) showFileContextMenu(item);
  });

  elements.fileList.addEventListener('keydown', (e) => {
    const items = getSortedFilteredItems();
    if (!items.length) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = state.fileListFocusIndex < 0 ? 0 : state.fileListFocusIndex + delta;
      setFileListFocus(next, items);
      const focused = items[state.fileListFocusIndex];
      if (focused && elements.fileList.classList.contains('windowed')) {
        const li = findFileListItem(focused.path);
        if (!li) {
          elements.fileList.scrollTop = Math.max(0, state.fileListFocusIndex * FILE_LIST_ROW_ESTIMATE - 40);
          renderFileList();
          setFileListFocus(state.fileListFocusIndex, items);
        }
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[state.fileListFocusIndex];
      if (item) selectFile(item.path);
      return;
    }

    if (e.key === 'F2') {
      e.preventDefault();
      const item = items[state.fileListFocusIndex];
      if (item) startRename(item.path);
    }
  });

  elements.fileList.addEventListener('scroll', debounce(() => {
    if (!elements.fileList.classList.contains('windowed')) return;
    if (state.renamingPath) return;
    renderFileList();
  }, 16));
}

function findFileListItem(filePath) {
  return [...elements.fileList.querySelectorAll('li')].find((li) => li.dataset.path === filePath) || null;
}

function flushPendingFolderItems() {
  if (state.pendingFolderItems) {
    const pending = state.pendingFolderItems;
    state.pendingFolderItems = null;
    applyFolderItems(pending);
  }
}

export function startRename(filePath) {
  if (!filePath || !state.currentFolderPath) return;
  const item = state.folderItems.find((f) => f.path === filePath);
  if (!item) return;

  state.renamingPath = filePath;
  let li = findFileListItem(filePath);
  if (!li && elements.fileList.classList.contains('windowed')) {
    const items = getSortedFilteredItems();
    const index = items.findIndex((entry) => entry.path === filePath);
    if (index >= 0) {
      elements.fileList.scrollTop = Math.max(0, index * FILE_LIST_ROW_ESTIMATE - 40);
      renderFileList();
      li = findFileListItem(filePath);
    }
  }
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
      flushPendingFolderItems();
      return;
    }
    const nextName = input.value.trim();
    if (!nextName || nextName === item.name) {
      renderFileList();
      flushPendingFolderItems();
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
      await showAlert('Could not rename file', err.message);
      renderFileList();
    } finally {
      flushPendingFolderItems();
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
  input.addEventListener('blur', () => {
    finish(true);
  });
}

export function renameCurrentFile() {
  if (!state.currentFilePath || !state.currentFolderPath) return;
  startRename(state.currentFilePath);
}

export function updateActiveFile() {
  elements.fileList.querySelectorAll('li').forEach((li) => {
    li.classList.toggle('active', li.dataset.path === state.currentFilePath);
  });
}

export function syncSortControls() {
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

export async function showSidebar(folderPath, folderName, items) {
  await stopFolderWatch();
  state.currentFolderPath = folderPath;
  state.folderItems = items;
  state.fileListFilter = '';
  state.tagFilter = [];
  state.fileListAnimate = true;
  state.fileListFocusIndex = 0;
  elements.fileListSearch.value = '';
  elements.folderName.textContent = folderName;
  elements.sidebar.classList.remove('hidden');
  syncSortControls();
  updateSidebarToggleState();
  renderFileList();
  recordRecent({ path: folderPath, type: 'folder', name: folderName });
  await startFolderWatch(folderPath);
}

export async function hideSidebar() {
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

const debouncedFileListFilter = debounce(() => {
  state.fileListFilter = elements.fileListSearch.value;
  renderFileList();
}, 120);

export function initFileListSearch() {
  elements.fileListSearch.addEventListener('input', debouncedFileListFilter);
}

export function initSidebarSort() {
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

export function focusFileFilter() {
  if (!state.currentFolderPath) return;
  if (state.settings.sidebar.collapsed) {
    updateSetting('sidebar.collapsed', false);
  }
  elements.fileListSearch.focus();
  elements.fileListSearch.select();
}

export function initTagPopover() {
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
