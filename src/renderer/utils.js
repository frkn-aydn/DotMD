import { state } from './state.js';

export const nameCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function cssFontFamily(stored, fallback) {
  if (!stored || stored === '__system__') return fallback;
  const escaped = stored.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}", ${fallback}`;
}

export function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function throttle(fn, wait) {
  let last = 0;
  let timer = null;
  let pendingArgs = null;
  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    pendingArgs = args;
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      last = now;
      const callArgs = pendingArgs;
      pendingArgs = null;
      fn(...callArgs);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        const callArgs = pendingArgs;
        pendingArgs = null;
        if (callArgs) fn(...callArgs);
      }, remaining);
    }
  };
}

export async function showConfirm(message, detail = '') {
  const result = await window.api.showMessageBox({
    type: 'question',
    buttons: ['OK', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message,
    detail,
  });
  return result.response === 0;
}

export async function showAlert(message, detail = '') {
  await window.api.showMessageBox({
    type: 'warning',
    buttons: ['OK'],
    defaultId: 0,
    message,
    detail,
  });
}

export async function confirmDiscardChanges(actionLabel = 'Continue without saving?') {
  if (!state.isDirty) return true;
  return showConfirm('You have unsaved changes.', actionLabel);
}

export function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function basenamePath(filePath) {
  return String(filePath || '').split(/[/\\]/).pop() || filePath;
}

export function countWords(text) {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    const isSpace = ch <= 32;
    if (!isSpace && !inWord) {
      count += 1;
      inWord = true;
    } else if (isSpace) {
      inWord = false;
    }
  }
  return count;
}

export function formatRelativeTime(timestamp) {
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
