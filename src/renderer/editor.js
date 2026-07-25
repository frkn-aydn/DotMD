import { state, elements } from './state.js';
import { debounce, throttle, countWords } from './utils.js';
import { debouncedPreview, scheduleSplitScrollSync, resetEditorMirrorText } from './preview.js';
import { debouncedFindHighlightRefresh, syncEditorHighlightScroll, highlightEditorMatches } from './find.js';

let editorHighlightStyleCache = null;
let editorHighlightSizeCache = { width: -1, height: -1 };
let autoSaveIntervalMs = null;

export function canSave() {
  if (!state.currentFilePath) return state.isDirty || Boolean(state.content);
  return state.isDirty || state.fileMissing;
}

export function setDirty(dirty) {
  state.isDirty = dirty;
  if (!dirty) state.autoSaveError = null;
  elements.btnSave.disabled = !canSave();
  window.api.setDirty(Boolean(dirty)).catch(() => {});
  updateStatusLabel();
  scheduleStatsUpdate();
  ensureAutoSaveTimer();
}

export function updateStatusLabel() {
  document.body.classList.toggle('file-open', !!state.currentFilePath || state.content !== '' || !elements.editorPane.classList.contains('hidden'));

  if (!state.currentFilePath && elements.editorPane.classList.contains('hidden')) {
    elements.statusFile.textContent = 'No file open';
    return;
  }

  if (!state.currentFilePath) {
    let label = 'Untitled';
    if (state.isDirty) label += '  •  Unsaved';
    elements.statusFile.textContent = label;
  } else {
    const name = state.currentFilePath.split(/[/\\]/).pop();
    let label = name;
    if (state.autoSaveError) label += '  •  Auto-save failed';
    else if (state.fileMissing) label += '  •  File missing';
    else if (state.isDirty) label += '  •  Unsaved';
    elements.statusFile.textContent = label;
  }
}

function updateStatusStats() {
  if (!state.currentFilePath && elements.editorPane.classList.contains('hidden')) {
    elements.statusStats.textContent = '';
    return;
  }
  const text = state.content || '';
  elements.statusStats.textContent = `${countWords(text)} words · ${text.length} chars`;
}

export function updateStatus() {
  updateStatusLabel();
  updateStatusStats();
}

const scheduleStatsUpdate = throttle(updateStatusStats, 300);

export function ensureAutoSaveTimer() {
  const { autoSave, autoSaveInterval } = state.settings.files;
  const shouldRun = autoSave && !!state.currentFilePath;
  const nextMs = (autoSaveInterval || 60) * 1000;

  if (!shouldRun) {
    if (state.autoSaveTimer) {
      clearInterval(state.autoSaveTimer);
      state.autoSaveTimer = null;
      autoSaveIntervalMs = null;
    }
    return;
  }

  if (state.autoSaveTimer && autoSaveIntervalMs === nextMs) return;

  if (state.autoSaveTimer) clearInterval(state.autoSaveTimer);
  autoSaveIntervalMs = nextMs;
  state.autoSaveTimer = setInterval(async () => {
    if (state.isDirty && state.currentFilePath) {
      const { saveFile } = await import('./workspace.js');
      saveFile({ silent: true });
    }
  }, nextMs);
}

export function syncEditorHighlightLayout({ force = false } = {}) {
  const editor = elements.editor;
  const layer = elements.editorHighlights;
  if (!layer) return;

  const width = editor.clientWidth;
  const height = editor.clientHeight;
  if (
    !force
    && editorHighlightStyleCache
    && editorHighlightSizeCache.width === width
    && editorHighlightSizeCache.height === height
  ) {
    return;
  }

  const style = getComputedStyle(editor);
  editorHighlightStyleCache = style;
  editorHighlightSizeCache = { width, height };
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
  layer.style.width = `${width}px`;
  layer.style.height = `${height}px`;
}

function insertEditorText(text) {
  const ok = document.execCommand('insertText', false, text);
  if (!ok) {
    const editor = elements.editor;
    const { selectionStart, selectionEnd } = editor;
    editor.setRangeText(text, selectionStart, selectionEnd, 'end');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function handleEditorTab(e) {
  if (e.key !== 'Tab') return;
  e.preventDefault();

  const editor = elements.editor;
  const { selectionStart, selectionEnd, value } = editor;
  const tabSize = state.settings.editor.tabSize || 2;
  const indentUnit = state.settings.editor.insertSpaces ? ' '.repeat(tabSize) : '\t';
  const selected = value.slice(selectionStart, selectionEnd);
  const isMultiLine = selected.includes('\n')
    || value.slice(0, selectionStart).lastIndexOf('\n')
      !== value.slice(0, selectionEnd).lastIndexOf('\n');

  if (!isMultiLine && !e.shiftKey) {
    insertEditorText(indentUnit);
    return;
  }

  const blockStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  let blockEnd = value.indexOf('\n', selectionEnd);
  if (blockEnd === -1) blockEnd = value.length;
  else if (selectionEnd > blockStart && value[selectionEnd - 1] === '\n') {
    // selection already ends at a line break; keep it
  }

  const block = value.slice(blockStart, blockEnd);
  const lines = block.split('\n');
  let transformed;
  if (e.shiftKey) {
    transformed = lines.map((line) => {
      if (line.startsWith(indentUnit)) return line.slice(indentUnit.length);
      if (line.startsWith('\t')) return line.slice(1);
      const leading = line.match(/^ */)[0].length;
      return line.slice(Math.min(leading, tabSize));
    }).join('\n');
  } else {
    transformed = lines.map((line) => (line.length ? indentUnit + line : line)).join('\n');
  }

  editor.focus();
  editor.setSelectionRange(blockStart, blockEnd);
  insertEditorText(transformed);
  editor.setSelectionRange(blockStart, blockStart + transformed.length);
}

export function initEditor() {
  elements.editor.addEventListener('input', () => {
    state.content = elements.editor.value;
    resetEditorMirrorText();
    setDirty(true);
    if (state.mode !== 'edit') debouncedPreview();
    else state.previewStale = true;
    scheduleSplitScrollSync();
    debouncedFindHighlightRefresh();
  });

  elements.editor.addEventListener('keyup', scheduleSplitScrollSync);
  elements.editor.addEventListener('click', scheduleSplitScrollSync);
  elements.editor.addEventListener('scroll', () => {
    syncEditorHighlightScroll();
    scheduleSplitScrollSync();
  });

  if (typeof ResizeObserver !== 'undefined') {
    const scheduleHighlightRelayout = debounce(() => {
      editorHighlightStyleCache = null;
      resetEditorMirrorText();
      if (elements.findBar.classList.contains('hidden')) return;
      if (state.mode !== 'edit' && state.mode !== 'split') return;
      if (!state.findQuery.trim()) return;
      highlightEditorMatches();
    }, 50);
    new ResizeObserver(scheduleHighlightRelayout).observe(elements.editor);
  }

  elements.editor.addEventListener('keydown', handleEditorTab);
}
