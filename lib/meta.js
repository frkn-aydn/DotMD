const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const { execFile } = require('child_process');
const { promisify } = require('util');
const { mapPool, chunkArray } = require('./util');

const execFileAsync = promisify(execFile);

const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd)$/i;
const META_ATTR = 'com.dotmd.meta';
const DEFAULT_FILE_META = { tags: [], pinned: false };
const STAT_CONCURRENCY = 16;
const XATTR_CHUNK = 200;

let getUserDataPath = null;
let fallbackMetaStore = null;
const metaCache = new Map(); // path -> { mtimeMs, meta }

function initMeta(appOrGetUserDataPath) {
  if (typeof appOrGetUserDataPath === 'function') {
    getUserDataPath = appOrGetUserDataPath;
  } else {
    getUserDataPath = () => appOrGetUserDataPath.getPath('userData');
  }
}

function getFileMetaFallbackPath() {
  return path.join(getUserDataPath(), 'dotmd-file-meta.json');
}

function isMarkdownFile(filePath) {
  return MARKDOWN_EXT.test(filePath);
}

function loadFallbackMetaStoreSync({ force = false } = {}) {
  if (!force && fallbackMetaStore) return fallbackMetaStore;
  try {
    const raw = fs.readFileSync(getFileMetaFallbackPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    fallbackMetaStore = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    fallbackMetaStore = {};
  }
  return fallbackMetaStore;
}

function saveFallbackMetaStoreSync(store) {
  fallbackMetaStore = store;
  fs.writeFileSync(getFileMetaFallbackPath(), JSON.stringify(store), 'utf-8');
}

function invalidateMetaCache(filePath) {
  if (filePath) metaCache.delete(path.resolve(filePath));
  else metaCache.clear();
}

function normalizeFileMeta(meta) {
  const tags = Array.isArray(meta?.tags)
    ? meta.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
    : [];
  return {
    tags: [...new Set(tags)],
    pinned: Boolean(meta?.pinned),
  };
}

async function readXattrRaw(filePath) {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('xattr', ['-p', META_ATTR, filePath], {
        encoding: 'utf-8',
      });
      return stdout.trim();
    }
    if (process.platform === 'linux') {
      const { stdout } = await execFileAsync(
        'getfattr',
        ['-n', `user.${META_ATTR}`, '--only-values', filePath],
        { encoding: 'utf-8' },
      );
      return stdout.trim();
    }
    if (process.platform === 'win32') {
      return (await fsp.readFile(`${filePath}:${META_ATTR}`, 'utf-8')).trim();
    }
  } catch {
    /* no xattr / ADS */
  }
  return null;
}

async function batchReadXattrDarwin(filePaths) {
  const result = new Map();
  if (!filePaths.length) return result;

  for (const chunk of chunkArray(filePaths, XATTR_CHUNK)) {
    try {
      const { stdout } = await execFileAsync('xattr', ['-p', META_ATTR, ...chunk], {
        encoding: 'utf-8',
        maxBuffer: 16 * 1024 * 1024,
      });
      // When multiple files are passed, xattr prefixes each value with "path: ".
      // A single file just returns the raw value.
      if (chunk.length === 1) {
        const value = stdout.trim();
        if (value) result.set(chunk[0], value);
        continue;
      }

      let currentPath = null;
      let currentValue = '';
      for (const line of stdout.split('\n')) {
        const match = line.match(/^(.+):\s(.*)$/);
        if (match && chunk.includes(match[1])) {
          if (currentPath && currentValue) result.set(currentPath, currentValue.trim());
          currentPath = match[1];
          currentValue = match[2];
        } else if (currentPath) {
          currentValue += `\n${line}`;
        }
      }
      if (currentPath && currentValue) result.set(currentPath, currentValue.trim());
    } catch (err) {
      // Missing attributes cause a nonzero exit; stdout may still contain found values.
      const stdout = err?.stdout || '';
      if (chunk.length === 1 && stdout.trim()) {
        result.set(chunk[0], stdout.trim());
      } else if (stdout) {
        let currentPath = null;
        let currentValue = '';
        for (const line of String(stdout).split('\n')) {
          const match = line.match(/^(.+):\s(.*)$/);
          if (match && chunk.includes(match[1])) {
            if (currentPath && currentValue) result.set(currentPath, currentValue.trim());
            currentPath = match[1];
            currentValue = match[2];
          } else if (currentPath) {
            currentValue += `\n${line}`;
          }
        }
        if (currentPath && currentValue) result.set(currentPath, currentValue.trim());
      }
    }
  }
  return result;
}

async function batchReadXattrLinux(filePaths) {
  const result = new Map();
  if (!filePaths.length) return result;

  for (const chunk of chunkArray(filePaths, XATTR_CHUNK)) {
    try {
      const { stdout } = await execFileAsync(
        'getfattr',
        ['-n', `user.${META_ATTR}`, '--only-values', ...chunk],
        { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 },
      );
      // getfattr with multiple files prints "# file: path" headers between values.
      const parts = stdout.split(/^# file: /m).filter(Boolean);
      if (parts.length && stdout.includes('# file:')) {
        for (const part of parts) {
          const nl = part.indexOf('\n');
          if (nl === -1) continue;
          const filePath = part.slice(0, nl).trim();
          const value = part.slice(nl + 1).trim();
          if (filePath && value) result.set(filePath, value);
        }
      } else if (chunk.length === 1 && stdout.trim()) {
        result.set(chunk[0], stdout.trim());
      }
    } catch (err) {
      const stdout = err?.stdout || '';
      if (stdout.includes('# file:')) {
        const parts = String(stdout).split(/^# file: /m).filter(Boolean);
        for (const part of parts) {
          const nl = part.indexOf('\n');
          if (nl === -1) continue;
          const filePath = part.slice(0, nl).trim();
          const value = part.slice(nl + 1).trim();
          if (filePath && value) result.set(filePath, value);
        }
      } else if (chunk.length === 1 && String(stdout).trim()) {
        result.set(chunk[0], String(stdout).trim());
      }
    }
  }
  return result;
}

async function batchReadXattrWin(filePaths) {
  const result = new Map();
  await mapPool(filePaths, STAT_CONCURRENCY, async (filePath) => {
    try {
      const value = (await fsp.readFile(`${filePath}:${META_ATTR}`, 'utf-8')).trim();
      if (value) result.set(filePath, value);
    } catch {
      /* no ADS */
    }
  });
  return result;
}

async function batchReadXattrRaw(filePaths) {
  if (process.platform === 'darwin') return batchReadXattrDarwin(filePaths);
  if (process.platform === 'linux') return batchReadXattrLinux(filePaths);
  if (process.platform === 'win32') return batchReadXattrWin(filePaths);
  return new Map();
}

async function writeXattrRaw(filePath, value) {
  try {
    if (process.platform === 'darwin') {
      await execFileAsync('xattr', ['-w', META_ATTR, value, filePath]);
      return true;
    }
    if (process.platform === 'linux') {
      await execFileAsync('setfattr', ['-n', `user.${META_ATTR}`, '-v', value, filePath]);
      return true;
    }
    if (process.platform === 'win32') {
      await fsp.writeFile(`${filePath}:${META_ATTR}`, value, 'utf-8');
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function metaFromRawOrStore(resolved, raw, store) {
  if (raw) {
    try {
      return normalizeFileMeta(JSON.parse(raw));
    } catch {
      /* fall through */
    }
  }
  if (store[resolved]) return normalizeFileMeta(store[resolved]);
  return { ...DEFAULT_FILE_META, tags: [] };
}

async function readFileMeta(filePath, { mtimeMs = null, store = null } = {}) {
  const resolved = path.resolve(filePath);
  if (mtimeMs != null) {
    const cached = metaCache.get(resolved);
    if (cached && cached.mtimeMs === mtimeMs) return cached.meta;
  }

  const raw = await readXattrRaw(resolved);
  const fallback = store || loadFallbackMetaStoreSync();
  const meta = metaFromRawOrStore(resolved, raw, fallback);
  if (mtimeMs != null) metaCache.set(resolved, { mtimeMs, meta });
  return meta;
}

async function writeFileMeta(filePath, meta) {
  const resolved = path.resolve(filePath);
  const normalized = normalizeFileMeta(meta);
  const payload = JSON.stringify(normalized);
  const wroteXattr = await writeXattrRaw(resolved, payload);

  const store = loadFallbackMetaStoreSync();
  if (wroteXattr) {
    if (store[resolved]) {
      delete store[resolved];
      saveFallbackMetaStoreSync(store);
    }
  } else {
    store[resolved] = normalized;
    saveFallbackMetaStoreSync(store);
  }
  invalidateMetaCache(resolved);
  return normalized;
}

function ensureMarkdownExtension(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  if (MARKDOWN_EXT.test(trimmed)) return trimmed;
  return `${trimmed}.md`;
}

async function uniqueFilePath(folderPath, preferredName) {
  const baseName = preferredName || 'Unnamed.md';
  const extMatch = baseName.match(MARKDOWN_EXT);
  const ext = extMatch ? extMatch[0] : '.md';
  const stem = extMatch ? baseName.slice(0, -ext.length) : baseName;

  let candidate = path.join(folderPath, `${stem}${ext}`);
  if (!fs.existsSync(candidate)) return candidate;

  let n = 2;
  while (fs.existsSync(path.join(folderPath, `${stem}-${n}${ext}`))) {
    n += 1;
  }
  return path.join(folderPath, `${stem}-${n}${ext}`);
}

module.exports = {
  initMeta,
  MARKDOWN_EXT,
  META_ATTR,
  DEFAULT_FILE_META,
  STAT_CONCURRENCY,
  isMarkdownFile,
  normalizeFileMeta,
  loadFallbackMetaStoreSync,
  saveFallbackMetaStoreSync,
  invalidateMetaCache,
  readFileMeta,
  writeFileMeta,
  ensureMarkdownExtension,
  uniqueFilePath,
  metaFromRawOrStore,
  batchReadXattrRaw,
  metaCache,
};
