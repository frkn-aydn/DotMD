import { state, elements } from './state.js';
import { debounce, showAlert } from './utils.js';
import { refreshFindHighlights } from './find.js';

let selectionChangeBound = false;

let editorMirror = null;
export let editorMirrorText = null;
let editorMirrorWidth = 0;
let lastCaretMeasure = { textLen: -1, top: 0 };

export function resetEditorMirrorText() {
  editorMirrorText = null;
  lastCaretMeasure = { textLen: -1, top: 0 };
}

function onSelectionChangeForSplit() {
  if (state.mode === 'split' && document.activeElement === elements.editor) {
    scheduleSplitScrollSync();
  }
}

function bindSplitSelectionSync(enabled) {
  if (enabled && !selectionChangeBound) {
    document.addEventListener('selectionchange', onSelectionChangeForSplit);
    selectionChangeBound = true;
  } else if (!enabled && selectionChangeBound) {
    document.removeEventListener('selectionchange', onSelectionChangeForSplit);
    selectionChangeBound = false;
  }
}

export function setMode(mode) {
  state.mode = mode;
  elements.content.className = `content mode-${mode}`;
  elements.modeBtns.forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active);
  });
  elements.statusMode.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
  bindSplitSelectionSync(mode === 'split');
  if (mode !== 'edit') {
    updatePreview();
  }
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
      if (!src) return;
      const trimmed = src.trim();
      if (/^(data:|file:|mailto:)/i.test(trimmed)) return;
      if (/^https?:\/\//i.test(trimmed)) {
        img.alt = img.alt || 'Remote images are disabled';
        return;
      }

      const cacheKey = `${state.currentFilePath}\0${trimmed}`;
      if (state.imageResolveCache.has(cacheKey)) {
        const cached = state.imageResolveCache.get(cacheKey);
        if (cached) img.src = cached;
        else img.alt = img.alt || 'Image not found';
        return;
      }

      try {
        const resolved = await window.api.resolveImagePath(state.currentFilePath, trimmed);
        state.imageResolveCache.set(cacheKey, resolved);
        if (resolved) img.src = resolved;
        else img.alt = img.alt || 'Image not found';
      } catch {
        state.imageResolveCache.set(cacheKey, null);
        img.alt = img.alt || 'Image not found';
      }
    }),
  );
}

export async function updatePreview() {
  if (state.mode === 'edit') {
    state.previewStale = true;
    return;
  }

  const markdown = state.content || '';
  const tokens = marked.lexer(markdown);
  elements.preview.innerHTML = marked.parser(tokens);
  if (state.mode === 'split') {
    annotatePreviewWithSourceLines(markdown, tokens);
  }
  await resolvePreviewImages();
  state.previewStale = false;
  refreshFindHighlights();
  if (state.mode === 'split') {
    requestAnimationFrame(() => syncPreviewToEditorCursor());
  }
}

function buildBlockLineMap(markdown, tokens) {
  const blocks = [];
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

function annotatePreviewWithSourceLines(markdown, tokens) {
  const blocks = buildBlockLineMap(markdown, tokens || marked.lexer(markdown));
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
  const caretTop = measureEditorOffsetTop(editor.selectionStart);
  return editorRect.top + paddingTop + caretTop - editor.scrollTop;
}

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
  const width = editor.clientWidth;
  mirror.style.font = style.font;
  mirror.style.padding = style.padding;
  mirror.style.width = `${width}px`;
  mirror.style.whiteSpace = editor.style.whiteSpace || style.whiteSpace;
  mirror.style.overflowWrap = editor.style.overflowWrap || style.overflowWrap;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.tabSize = style.tabSize;
  if (width !== editorMirrorWidth) {
    editorMirrorWidth = width;
    editorMirrorText = null;
  }
}

export function measureEditorOffsetTop(absoluteIndex) {
  const editor = elements.editor;
  const style = getComputedStyle(editor);
  const lineWrap = editor.style.whiteSpace === 'pre-wrap' || style.whiteSpace === 'pre-wrap';
  const lineHeight = parseFloat(style.lineHeight) || 20;

  if (!lineWrap) {
    const textBefore = editor.value.slice(0, absoluteIndex);
    return (textBefore.split('\n').length - 1) * lineHeight;
  }

  const before = editor.value.slice(0, absoluteIndex);
  if (
    editorMirrorText === before
    && lastCaretMeasure.textLen === before.length
  ) {
    return lastCaretMeasure.top;
  }

  const mirror = getEditorMirror();
  syncEditorMirrorStyles();
  mirror.textContent = before;
  const marker = document.createElement('span');
  marker.textContent = '.';
  mirror.appendChild(marker);
  const caretTop = marker.offsetTop;
  mirror.textContent = '';
  editorMirrorText = before;
  lastCaretMeasure = { textLen: before.length, top: caretTop };
  return caretTop;
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

export const scheduleSplitScrollSync = debounce(() => {
  if (state.mode === 'split') syncPreviewToEditorCursor();
}, 16);

export const debouncedPreview = debounce(updatePreview, 60);

function slugifyHeading(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function scrollPreviewToHash(hash) {
  if (!hash) return;
  const decoded = (() => {
    try {
      return decodeURIComponent(hash);
    } catch {
      return hash;
    }
  })();

  const byId = elements.preview.querySelector(`#${CSS.escape(decoded)}`);
  if (byId) {
    byId.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }

  const headings = elements.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
  for (const heading of headings) {
    if (slugifyHeading(heading.textContent) === slugifyHeading(decoded)) {
      heading.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
  }
}

function isUnderCurrentFolder(filePath) {
  if (!state.currentFolderPath || !filePath) return false;
  if (state.folderItems.some((item) => item.path === filePath)) return true;
  const folder = state.currentFolderPath.replace(/[/\\]+$/, '');
  const parent = filePath.replace(/[/\\][^/\\]+$/, '');
  return parent === folder;
}

async function handlePreviewLinkClick(event) {
  const anchor = event.target.closest('a[href]');
  if (!anchor || !elements.preview.contains(anchor)) return;

  const href = anchor.getAttribute('href');
  if (!href) return;

  event.preventDefault();

  try {
    const resolved = await window.api.resolveLinkPath(state.currentFilePath, href);
    if (!resolved) return;

    if (resolved.type === 'external') {
      await window.api.openExternal(resolved.url);
      return;
    }

    if (resolved.type === 'anchor') {
      scrollPreviewToHash(resolved.hash);
      return;
    }

    if (resolved.type === 'missing') {
      await showAlert('Linked file not found', resolved.path || href);
      return;
    }

    if (resolved.type === 'file') {
      await window.api.openPath(resolved.path);
      return;
    }

    if (resolved.type === 'markdown') {
      if (resolved.path === state.currentFilePath) {
        if (resolved.hash) scrollPreviewToHash(resolved.hash);
        return;
      }

      const { selectFile, openFileFromPath } = await import('./workspace.js');
      if (isUnderCurrentFolder(resolved.path)) {
        await selectFile(resolved.path);
      } else {
        await openFileFromPath(resolved.path);
      }

      if (resolved.hash) {
        // Wait for preview to render the newly opened file.
        requestAnimationFrame(() => {
          setTimeout(() => scrollPreviewToHash(resolved.hash), 50);
        });
      }
    }
  } catch (err) {
    await showAlert('Could not open link', err.message || String(err));
  }
}

export function initPreviewLinks() {
  elements.preview.addEventListener('click', (event) => {
    if (!event.target.closest('a[href]')) return;
    handlePreviewLinkClick(event);
  });
}
