import { state, elements } from './state.js';
import { debounce, escapeRegExp, escapeHtml } from './utils.js';
import { measureEditorOffsetTop } from './preview.js';
import { syncEditorHighlightLayout } from './editor.js';

export function syncEditorHighlightScroll() {
  const layer = elements.editorHighlights;
  if (!layer) return;
  layer.scrollTop = elements.editor.scrollTop;
  layer.scrollLeft = elements.editor.scrollLeft;
}

function clearEditorHighlights() {
  if (!elements.editorHighlights) return;
  elements.editorHighlights.innerHTML = '';
}

export function highlightEditorMatches() {
  const layer = elements.editorHighlights;
  if (!layer) return;

  const text = elements.editor.value;
  const query = state.findQuery.trim();
  if (!query || !state.findMatches.length) {
    clearEditorHighlights();
    return;
  }

  syncEditorHighlightLayout({ force: true });

  let html = '';
  let lastIndex = 0;
  state.findMatches.forEach((match, index) => {
    html += escapeHtml(text.slice(lastIndex, match.start));
    const cls = index === state.findIndex ? 'search-hit search-hit-current' : 'search-hit';
    html += `<mark class="${cls}">${escapeHtml(text.slice(match.start, match.end))}</mark>`;
    lastIndex = match.end;
  });
  html += escapeHtml(text.slice(lastIndex));
  layer.innerHTML = `${html}\n`;
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
  elements.editor.setSelectionRange(match.start, match.end);
  scrollTextareaToSelection(elements.editor);
  syncEditorHighlightScroll();
}

function scrollTextareaToSelection(textarea) {
  const style = window.getComputedStyle(textarea);
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const lineHeight = parseFloat(style.lineHeight) || 20;
  const caretTop = measureEditorOffsetTop(textarea.selectionStart);
  const viewHeight = textarea.clientHeight;
  const target = Math.max(0, caretTop - (viewHeight / 2) + paddingTop + lineHeight);
  textarea.scrollTop = target;
}

export function refreshFindHighlights() {
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

  clearPreviewHighlights();
  highlightEditorMatches();
  if (state.findMatches.length) scrollEditorToMatch(state.findIndex);
}

export function openFindBar() {
  if (!state.currentFilePath && elements.editorPane.classList.contains('hidden')) return;
  elements.findBar.classList.remove('hidden');
  elements.findInput.focus();
  elements.findInput.select();
  refreshFindHighlights();
}

export function closeFindBar() {
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

  highlightEditorMatches();
  scrollEditorToMatch(state.findIndex);
}

export const debouncedFindHighlightRefresh = debounce(() => {
  if (!elements.findBar.classList.contains('hidden')) {
    refreshFindHighlights();
  }
}, 80);

export function initFindBar() {
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
