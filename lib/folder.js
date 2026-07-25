const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const { mapPool } = require('./util');
const {
  MARKDOWN_EXT,
  STAT_CONCURRENCY,
  loadFallbackMetaStoreSync,
  metaFromRawOrStore,
  batchReadXattrRaw,
  metaCache,
} = require('./meta');

async function readDirectory(dirPath) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => !entry.name.startsWith('.') && entry.isFile() && MARKDOWN_EXT.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
    }));

  const store = loadFallbackMetaStoreSync();

  const stated = await mapPool(candidates, STAT_CONCURRENCY, async (candidate) => {
    let mtime = 0;
    let birthtime = 0;
    let size = 0;
    try {
      const stat = await fsp.stat(candidate.path);
      mtime = stat.mtimeMs || 0;
      birthtime = stat.birthtimeMs || stat.ctimeMs || mtime;
      size = stat.size || 0;
    } catch {
      /* ignore stat errors */
    }
    return { ...candidate, mtime, birthtime, size };
  });

  const needsXattr = [];
  for (const item of stated) {
    const resolved = path.resolve(item.path);
    const cached = metaCache.get(resolved);
    if (cached && cached.mtimeMs === item.mtime) {
      item.meta = cached.meta;
    } else {
      needsXattr.push(item);
    }
  }

  if (needsXattr.length) {
    const xattrMap = await batchReadXattrRaw(needsXattr.map((item) => item.path));
    for (const item of needsXattr) {
      const resolved = path.resolve(item.path);
      const raw = xattrMap.get(item.path) || xattrMap.get(resolved) || null;
      const meta = metaFromRawOrStore(resolved, raw, store);
      metaCache.set(resolved, { mtimeMs: item.mtime, meta });
      item.meta = meta;
    }
  }

  const items = stated.map((item) => ({
    name: item.name,
    path: item.path,
    type: 'file',
    mtime: item.mtime,
    birthtime: item.birthtime,
    size: item.size,
    tags: item.meta.tags,
    pinned: item.meta.pinned,
  }));

  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

function createFolderWatchController({ onChange, onError }) {
  let folderWatcher = null;
  let folderWatchPath = null;
  let folderWatchTimer = null;

  function stop() {
    if (folderWatchTimer) {
      clearTimeout(folderWatchTimer);
      folderWatchTimer = null;
    }
    if (folderWatcher) {
      folderWatcher.close();
      folderWatcher = null;
    }
    folderWatchPath = null;
  }

  async function emitFolderChanged(folderPath) {
    try {
      const items = await readDirectory(folderPath);
      if (onChange) onChange(folderPath, items);
    } catch {
      /* ignore read errors during watch */
    }
  }

  function scheduleRefresh(folderPath) {
    if (folderWatchTimer) clearTimeout(folderWatchTimer);
    folderWatchTimer = setTimeout(() => {
      folderWatchTimer = null;
      emitFolderChanged(folderPath);
    }, 500);
  }

  function arm(resolved) {
    try {
      folderWatcher = fs.watch(resolved, { persistent: false }, (_eventType, _filename) => {
        scheduleRefresh(resolved);
      });
      folderWatcher.on('error', () => {
        stop();
        if (onError) onError({ folderPath: resolved });
        // Attempt a single re-arm shortly after; ignore failure.
        setTimeout(() => {
          if (folderWatchPath === resolved || !folderWatchPath) {
            try {
              if (fs.existsSync(resolved)) {
                folderWatchPath = resolved;
                arm(resolved);
              }
            } catch {
              /* give up */
            }
          }
        }, 1000);
      });
      folderWatchPath = resolved;
      return true;
    } catch {
      stop();
      return false;
    }
  }

  function watch(folderPath) {
    const resolved = path.resolve(folderPath);
    if (folderWatchPath === resolved && folderWatcher) {
      return true;
    }
    stop();
    return arm(resolved);
  }

  function getWatchPath() {
    return folderWatchPath;
  }

  return { stop, watch, scheduleRefresh, getWatchPath };
}

module.exports = { readDirectory, createFolderWatchController };
