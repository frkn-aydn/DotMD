const { app, BrowserWindow, dialog, ipcMain, Menu, shell, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const APP_NAME = 'DotMD';
const isMac = process.platform === 'darwin';
const iconPngPath = path.join(__dirname, 'build', 'icon.png');
const iconIcnsPath = path.join(__dirname, 'build', 'icon.icns');

process.title = APP_NAME;
app.setName(APP_NAME);
app.setAppUserModelId('com.furkanaydin.dotmd');

let mainWindow;
const pendingOpenPaths = [];
let folderWatcher = null;
let folderWatchPath = null;
let folderWatchTimer = null;
let cachedSystemFonts = null;
let fontScanPromise = null;

function getFontCachePath() {
  return path.join(app.getPath('userData'), 'system-fonts-cache.json');
}

function loadFontCacheSync() {
  try {
    const raw = fs.readFileSync(getFontCachePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.platform && parsed.platform !== process.platform) return false;
    if (Array.isArray(parsed.fonts) && parsed.fonts.length) {
      cachedSystemFonts = parsed.fonts;
      return true;
    }
  } catch {
    /* no cache yet */
  }
  return false;
}

function mergeFontLists(existing, scanned) {
  return sortFontFamilies([...(existing || []), ...(scanned || [])]);
}

function fontsListChanged(before, after) {
  if (!before || before.length !== after.length) return true;
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] !== after[i]) return true;
  }
  return false;
}

const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd)$/i;
const META_ATTR = 'com.dotmd.meta';
const DEFAULT_FILE_META = { tags: [], pinned: false };

function isMarkdownFile(filePath) {
  return MARKDOWN_EXT.test(filePath);
}

function getFileMetaFallbackPath() {
  return path.join(app.getPath('userData'), 'dotmd-file-meta.json');
}

function loadFallbackMetaStoreSync() {
  try {
    const raw = fs.readFileSync(getFileMetaFallbackPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveFallbackMetaStoreSync(store) {
  fs.writeFileSync(getFileMetaFallbackPath(), JSON.stringify(store), 'utf-8');
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

async function readFileMeta(filePath) {
  const resolved = path.resolve(filePath);
  const raw = await readXattrRaw(resolved);
  if (raw) {
    try {
      return normalizeFileMeta(JSON.parse(raw));
    } catch {
      /* fall through */
    }
  }

  const store = loadFallbackMetaStoreSync();
  if (store[resolved]) return normalizeFileMeta(store[resolved]);
  return { ...DEFAULT_FILE_META, tags: [] };
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

function queueOpenFile(filePath) {
  if (!filePath || !isMarkdownFile(filePath)) return;

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return;

  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('open-file-path', resolved);
    return;
  }

  if (!pendingOpenPaths.includes(resolved)) {
    pendingOpenPaths.push(resolved);
  }
}

function flushPendingOpenFiles() {
  while (pendingOpenPaths.length) {
    const resolved = pendingOpenPaths.shift();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('open-file-path', resolved);
    }
  }
}

function getMarkdownPathsFromArgv(argv) {
  return argv
    .slice(1)
    .filter((arg) => arg && !arg.startsWith('-') && isMarkdownFile(arg))
    .map((arg) => path.resolve(arg))
    .filter((resolved) => fs.existsSync(resolved));
}

function getAppIcon() {
  const file =
    isMac && fs.existsSync(iconIcnsPath) ? iconIcnsPath : iconPngPath;
  if (!fs.existsSync(file)) return undefined;
  const image = nativeImage.createFromPath(file);
  return image.isEmpty() ? undefined : image;
}

function applyAppIcon() {
  const icon = getAppIcon();
  if (!icon) return;
  if (isMac && app.dock) {
    app.dock.setIcon(icon);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    title: APP_NAME,
    icon: getAppIcon(),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d1117' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle(APP_NAME);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  buildMenu();

  mainWindow.webContents.once('did-finish-load', () => {
    if (cachedSystemFonts?.length) {
      notifyFontsUpdated(cachedSystemFonts);
    }
    getMarkdownPathsFromArgv(process.argv).forEach(queueOpenFile);
    flushPendingOpenFiles();
  });
}

function buildMenu() {
  const send = (channel) => () => mainWindow && mainWindow.webContents.send(channel);

  const template = [
    ...(isMac ? [{ role: 'appMenu', label: APP_NAME }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New File', accelerator: 'CmdOrCtrl+T', click: send('menu-new-file') },
        { label: 'Open File…', accelerator: 'CmdOrCtrl+O', click: send('menu-open-file') },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: send('menu-open-folder') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('menu-save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('menu-save-as') },
        { label: 'Close File', accelerator: 'CmdOrCtrl+W', click: send('menu-close-file') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Rename File', accelerator: 'F2', click: send('menu-rename-file') },
        { label: 'Pin / Unpin', accelerator: 'CmdOrCtrl+Shift+P', click: send('menu-toggle-pin') },
        { label: 'Add Tag…', accelerator: 'CmdOrCtrl+E', click: send('menu-add-tag') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: send('menu-toggle-sidebar') },
        { label: 'Find in File…', accelerator: 'CmdOrCtrl+F', click: send('menu-find') },
        { label: 'Focus File Filter', accelerator: 'CmdOrCtrl+Shift+F', click: send('menu-focus-filter') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: send('menu-settings') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    ...(isMac ? [{ role: 'windowMenu' }] : []),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function readDirectory(dirPath) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isFile()) continue;
    if (!MARKDOWN_EXT.test(entry.name)) continue;

    const filePath = path.join(dirPath, entry.name);
    let mtime = 0;
    let birthtime = 0;
    let size = 0;
    try {
      const stat = await fsp.stat(filePath);
      mtime = stat.mtimeMs || 0;
      birthtime = stat.birthtimeMs || stat.ctimeMs || mtime;
      size = stat.size || 0;
    } catch {
      /* ignore stat errors */
    }

    const meta = await readFileMeta(filePath);
    items.push({
      name: entry.name,
      path: filePath,
      type: 'file',
      mtime,
      birthtime,
      size,
      tags: meta.tags,
      pinned: meta.pinned,
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePaths.length) return null;

  const filePath = result.filePaths[0];
  const content = await fsp.readFile(filePath, 'utf-8');
  return { filePath, content, fileName: path.basename(filePath) };
});

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths.length) return null;

  const folderPath = result.filePaths[0];
  const items = await readDirectory(folderPath);
  return { folderPath, folderName: path.basename(folderPath), items };
});

ipcMain.handle('read-file', async (_event, filePath) => {
  const content = await fsp.readFile(filePath, 'utf-8');
  return { filePath, content, fileName: path.basename(filePath) };
});

ipcMain.handle('save-file', async (_event, filePath, content) => {
  await fsp.writeFile(filePath, content, 'utf-8');
  return { success: true };
});

ipcMain.handle('save-file-dialog', async (_event, { content = '', defaultPath } = {}) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath || 'Unnamed.md',
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePath) return null;

  let filePath = result.filePath;
  if (!MARKDOWN_EXT.test(filePath)) {
    filePath = `${filePath}.md`;
  }

  await fsp.writeFile(filePath, content, 'utf-8');
  return { filePath, fileName: path.basename(filePath), content };
});

ipcMain.handle('create-file', async (_event, { folderPath, preferredName = 'Unnamed.md' } = {}) => {
  if (!folderPath) throw new Error('No folder selected');
  const filePath = await uniqueFilePath(folderPath, preferredName);
  const content = '';
  await fsp.writeFile(filePath, content, 'utf-8');
  await writeFileMeta(filePath, DEFAULT_FILE_META);
  return { filePath, fileName: path.basename(filePath), content };
});

ipcMain.handle('rename-file', async (_event, { oldPath, newName } = {}) => {
  if (!oldPath || !newName) throw new Error('Missing path or name');
  const safeName = ensureMarkdownExtension(newName);
  if (!safeName) throw new Error('Invalid file name');
  if (/[\\/]/.test(safeName) || safeName === '.' || safeName === '..') {
    throw new Error('Invalid file name');
  }

  const dir = path.dirname(oldPath);
  const newPath = path.join(dir, safeName);
  if (path.resolve(oldPath) === path.resolve(newPath)) {
    return { filePath: oldPath, fileName: path.basename(oldPath) };
  }
  if (fs.existsSync(newPath)) {
    throw new Error('A file with that name already exists');
  }

  const meta = await readFileMeta(oldPath);
  await fsp.rename(oldPath, newPath);
  await writeFileMeta(newPath, meta);

  const oldResolved = path.resolve(oldPath);
  const store = loadFallbackMetaStoreSync();
  if (store[oldResolved]) {
    delete store[oldResolved];
    saveFallbackMetaStoreSync(store);
  }

  return { filePath: newPath, fileName: path.basename(newPath) };
});

ipcMain.handle('update-file-meta', async (_event, { filePath, tags, pinned } = {}) => {
  if (!filePath) throw new Error('Missing file path');
  const current = await readFileMeta(filePath);
  const next = {
    tags: tags !== undefined ? tags : current.tags,
    pinned: pinned !== undefined ? pinned : current.pinned,
  };
  const saved = await writeFileMeta(filePath, next);
  return { filePath, ...saved };
});

ipcMain.handle('show-file-context-menu', async (event, payload = {}) => {
  const { filePath, pinned = false, tags = [], x, y } = payload;
  if (!filePath) return null;

  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const tagItems = (Array.isArray(tags) ? tags : []).map((tag) => ({
      label: `Remove Tag “${tag}”`,
      click: () => done({ action: 'remove-tag', tag }),
    }));

    const template = [
      {
        label: pinned ? 'Unpin' : 'Pin',
        accelerator: 'CmdOrCtrl+Shift+P',
        click: () => done({ action: 'pin' }),
      },
      {
        label: 'Rename…',
        accelerator: 'F2',
        click: () => done({ action: 'rename' }),
      },
      { type: 'separator' },
      {
        label: 'Add Tag…',
        accelerator: 'CmdOrCtrl+E',
        click: () => done({ action: 'add-tag' }),
      },
      ...tagItems,
    ];

    const menu = Menu.buildFromTemplate(template);
    const opts = {
      window: win,
      callback: () => done(null),
    };
    if (typeof x === 'number' && typeof y === 'number') {
      opts.x = Math.round(x);
      opts.y = Math.round(y);
    }
    menu.popup(opts);
  });
});

ipcMain.handle('show-tag-context-menu', async (event, payload = {}) => {
  const { tag, x, y } = payload;
  if (!tag) return null;

  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const menu = Menu.buildFromTemplate([
      {
        label: `Remove “${tag}”`,
        click: () => done({ action: 'remove', tag }),
      },
    ]);

    const opts = {
      window: win,
      callback: () => done(null),
    };
    if (typeof x === 'number' && typeof y === 'number') {
      opts.x = Math.round(x);
      opts.y = Math.round(y);
    }
    menu.popup(opts);
  });
});

ipcMain.handle('list-folder', async (_event, folderPath) => {
  return readDirectory(folderPath);
});

ipcMain.handle('path-exists', async (_event, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') {
    return { exists: false, isFile: false, isDirectory: false };
  }
  try {
    const stat = await fsp.stat(targetPath);
    return {
      exists: true,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
    };
  } catch {
    return { exists: false, isFile: false, isDirectory: false };
  }
});

function sortFontFamilies(families) {
  return [...new Set(families.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}

async function getMacOSFonts() {
  const profiler = fs.existsSync('/usr/sbin/system_profiler')
    ? '/usr/sbin/system_profiler'
    : 'system_profiler';
  const { stdout } = await execFileAsync(profiler, ['-json', 'SPFontsDataType'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const data = JSON.parse(stdout);
  const families = [];

  for (const font of data.SPFontsDataType || []) {
    if (typeof font.family === 'string' && font.family.trim()) {
      families.push(font.family.trim());
    }

    for (const typeface of font.typefaces || []) {
      if (typeof typeface.family === 'string' && typeface.family.trim()) {
        families.push(typeface.family.trim());
      }
    }
  }

  return sortFontFamilies(families);
}

async function getWindowsFonts() {
  const script =
    'Add-Type -AssemblyName System.Drawing; ' +
    '[System.Drawing.Text.InstalledFontCollection]::new().Families | ' +
    'ForEach-Object { $_.Name }';
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-Command', script],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return sortFontFamilies(stdout.split(/\r?\n/));
}

async function getLinuxFonts() {
  const { stdout } = await execFileAsync('fc-list', [':family', '--format=%{family}\n'], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const families = [];

  for (const line of stdout.split('\n')) {
    for (const part of line.split(',')) {
      const name = part.trim();
      if (name) families.push(name);
    }
  }

  return sortFontFamilies(families);
}

async function readFontCache() {
  try {
    const raw = await fsp.readFile(getFontCachePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.platform && parsed.platform !== process.platform) return null;
    if (Array.isArray(parsed.fonts) && parsed.fonts.length) {
      return parsed.fonts;
    }
  } catch {
    /* no cache yet */
  }
  return null;
}

async function writeFontCache(fonts) {
  await fsp.writeFile(
    getFontCachePath(),
    JSON.stringify({ fonts, updatedAt: Date.now(), platform: process.platform }),
    'utf-8',
  );
}

async function enumerateSystemFonts() {
  if (process.platform === 'darwin') return getMacOSFonts();
  if (process.platform === 'win32') return getWindowsFonts();
  return getLinuxFonts();
}

async function refreshSystemFonts({ broadcast = false } = {}) {
  const previous = cachedSystemFonts ? [...cachedSystemFonts] : [];
  const scanned = await enumerateSystemFonts();
  const merged = mergeFontLists(previous, scanned);
  cachedSystemFonts = merged;
  await writeFontCache(merged).catch(() => {});
  if (broadcast && fontsListChanged(previous, merged)) {
    notifyFontsUpdated(merged);
  }
  return merged;
}

function notifyFontsUpdated(fonts) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('fonts-updated', fonts);
  }
}

function startFontScan({ broadcastOnComplete = false } = {}) {
  if (fontScanPromise) return fontScanPromise;

  fontScanPromise = refreshSystemFonts({ broadcast: broadcastOnComplete })
    .catch((err) => {
      console.error('Failed to enumerate system fonts:', err);
      if (!cachedSystemFonts) cachedSystemFonts = [];
      return cachedSystemFonts;
    })
    .finally(() => {
      fontScanPromise = null;
    });

  return fontScanPromise;
}

async function getSystemFonts() {
  if (cachedSystemFonts) return cachedSystemFonts;

  const cached = await readFontCache();
  if (cached) {
    cachedSystemFonts = cached;
    startFontScan({ broadcastOnComplete: true });
    return cachedSystemFonts;
  }

  if (fontScanPromise) return fontScanPromise;
  return startFontScan({ broadcastOnComplete: true });
}

ipcMain.handle('get-system-fonts', async () => getSystemFonts());

function stopFolderWatch() {
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
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const items = await readDirectory(folderPath);
    mainWindow.webContents.send('folder-changed', { folderPath, items });
  } catch {
    /* ignore read errors during watch */
  }
}

function scheduleFolderRefresh(folderPath) {
  if (folderWatchTimer) clearTimeout(folderWatchTimer);
  folderWatchTimer = setTimeout(() => {
    folderWatchTimer = null;
    emitFolderChanged(folderPath);
  }, 300);
}

ipcMain.handle('watch-folder', async (_event, folderPath) => {
  if (!folderPath) return { success: false };

  const resolved = path.resolve(folderPath);
  if (folderWatchPath === resolved && folderWatcher) {
    return { success: true };
  }

  stopFolderWatch();

  try {
    folderWatcher = fs.watch(resolved, { persistent: false }, () => {
      scheduleFolderRefresh(resolved);
    });
    folderWatchPath = resolved;
    return { success: true };
  } catch {
    stopFolderWatch();
    return { success: false };
  }
});

ipcMain.handle('unwatch-folder', async () => {
  stopFolderWatch();
  return { success: true };
});

ipcMain.handle('resolve-image-path', async (_event, markdownFilePath, src) => {
  if (!markdownFilePath || !src) return null;

  const href = src.trim();
  if (/^(https?:|data:|file:|mailto:)/i.test(href)) return href;

  const baseDir = path.dirname(markdownFilePath);
  const withoutHash = href.split('#')[0].split('?')[0];
  const absolutePath = path.resolve(baseDir, withoutHash);

  try {
    const stat = await fsp.stat(absolutePath);
    if (!stat.isFile()) return null;
    return pathToFileURL(absolutePath).href;
  } catch {
    return null;
  }
});

// macOS: open .md files from Finder / double-click
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  queueOpenFile(filePath);
});

// Windows / Linux: route additional launches to this instance
if (!isMac) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', (_event, argv) => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
      getMarkdownPathsFromArgv(argv).forEach(queueOpenFile);
      flushPendingOpenFiles();
    });
  }
}

app.whenReady().then(() => {
  if (isMac) {
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
    });
  }
  applyAppIcon();
  loadFontCacheSync();
  startFontScan({ broadcastOnComplete: true }).catch(() => {});
  createWindow();
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
