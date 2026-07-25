const { app, BrowserWindow, dialog, ipcMain, Menu, shell, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const { pathToFileURL } = require('url');

const meta = require('./lib/meta');
const { readDirectory, createFolderWatchController } = require('./lib/folder');
const fonts = require('./lib/fonts');

const {
  initMeta,
  MARKDOWN_EXT,
  DEFAULT_FILE_META,
  isMarkdownFile,
  loadFallbackMetaStoreSync,
  saveFallbackMetaStoreSync,
  invalidateMetaCache,
  readFileMeta,
  writeFileMeta,
  ensureMarkdownExtension,
  uniqueFilePath,
} = meta;

const {
  getSystemFonts,
  loadFontCacheSync,
  startFontScan,
  setFontsBroadcast,
  getCachedSystemFonts,
} = fonts;

initMeta(app);
fonts.initFonts(app);

const APP_NAME = 'DotMD';
const isMac = process.platform === 'darwin';
const iconPngPath = path.join(__dirname, 'build', 'icon.png');
const iconIcnsPath = path.join(__dirname, 'build', 'icon.icns');

process.title = APP_NAME;
app.setName(APP_NAME);
app.setAppUserModelId('com.furkanaydin.dotmd');

let mainWindow;
const pendingOpenPaths = [];
let rendererDirty = false;
let isQuitting = false;

const folderWatch = createFolderWatchController({
  onChange: (folderPath, items) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('folder-changed', { folderPath, items });
    }
  },
  onError: ({ folderPath }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('folder-watch-error', { folderPath });
    }
  },
});

setFontsBroadcast((fontList) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('fonts-updated', fontList);
  }
});

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

  mainWindow.on('close', async (event) => {
    if (isQuitting || !rendererDirty) return;
    event.preventDefault();
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Do you want to save your changes?',
      detail: 'Your changes will be lost if you don’t save them.',
      noLink: true,
    });
    if (response === 2) {
      isQuitting = false;
      return;
    }
    if (response === 0) {
      mainWindow.webContents.send('request-save-before-quit');
      // Renderer will call confirm-quit after save attempt.
      return;
    }
    rendererDirty = false;
    isQuitting = true;
    mainWindow.destroy();
    app.quit();
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

  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable && !params.selectionText) return;

    const items = [];
    for (const suggestion of params.dictionarySuggestions || []) {
      items.push({
        label: suggestion,
        click: () => mainWindow.webContents.replaceMisspelling(suggestion),
      });
    }
    if (params.misspelledWord) {
      if (items.length) items.push({ type: 'separator' });
      items.push({
        label: 'Add to Dictionary',
        click: () =>
          mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) {
      items.push(
        { role: 'cut', enabled: params.editFlags?.canCut !== false },
        { role: 'copy', enabled: params.editFlags?.canCopy !== false },
        { role: 'paste', enabled: params.editFlags?.canPaste !== false },
        { type: 'separator' },
        { role: 'selectAll' },
      );
    } else if (params.selectionText) {
      items.push({ role: 'copy' });
    }

    if (!items.length) return;
    const menu = Menu.buildFromTemplate(items);
    const opts = { window: mainWindow };
    if (params.frame) opts.frame = params.frame;
    menu.popup(opts);
  });

  buildMenu();

  mainWindow.webContents.once('did-finish-load', () => {
    const cachedSystemFonts = getCachedSystemFonts();
    if (cachedSystemFonts?.length) {
      mainWindow.webContents.send('fonts-updated', cachedSystemFonts);
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

function assertWritablePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path');
  }
  const resolved = path.resolve(filePath);
  if (resolved.includes('\0')) throw new Error('Invalid file path');
  return resolved;
}

ipcMain.handle('save-file', async (_event, filePath, content, options = {}) => {
  const resolved = assertWritablePath(filePath);
  if (options.expectedMtime != null) {
    try {
      const stat = await fsp.stat(resolved);
      if (Math.abs((stat.mtimeMs || 0) - options.expectedMtime) > 1) {
        return {
          success: false,
          conflict: true,
          mtime: stat.mtimeMs || 0,
        };
      }
    } catch {
      /* file may be missing; allow recreate */
    }
  }
  await fsp.writeFile(resolved, content, 'utf-8');
  invalidateMetaCache(resolved);
  const stat = await fsp.stat(resolved);
  return { success: true, mtime: stat.mtimeMs || 0, size: stat.size || 0 };
});

ipcMain.handle('get-file-stat', async (_event, filePath) => {
  try {
    const resolved = assertWritablePath(filePath);
    const stat = await fsp.stat(resolved);
    return {
      exists: true,
      mtime: stat.mtimeMs || 0,
      size: stat.size || 0,
      isFile: stat.isFile(),
    };
  } catch {
    return { exists: false, mtime: 0, size: 0, isFile: false };
  }
});

ipcMain.handle('show-message-box', async (event, options = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const result = await dialog.showMessageBox(win, {
    type: options.type || 'question',
    buttons: options.buttons || ['OK'],
    defaultId: options.defaultId ?? 0,
    cancelId: options.cancelId,
    message: options.message || '',
    detail: options.detail || undefined,
    noLink: true,
  });
  return { response: result.response };
});

ipcMain.handle('set-dirty', async (_event, dirty) => {
  rendererDirty = Boolean(dirty);
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

  const fileMeta = await readFileMeta(oldPath);
  await fsp.rename(oldPath, newPath);
  await writeFileMeta(newPath, fileMeta);

  const oldResolved = path.resolve(oldPath);
  invalidateMetaCache(oldResolved);
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

function popupMenuAtCursor(event, template) {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const menu = Menu.buildFromTemplate(
      template.map((item) => {
        if (typeof item.click === 'function') {
          const original = item.click;
          return {
            ...item,
            click: () => original(done),
          };
        }
        return item;
      }),
    );

    const opts = {
      window: win,
      callback: () => done(null),
    };
    if (event.senderFrame) opts.frame = event.senderFrame;
    // Intentionally omit x/y so Electron uses the OS cursor position (correct at any zoom).
    menu.popup(opts);
  });
}

ipcMain.handle('show-file-context-menu', async (event, payload = {}) => {
  const { filePath, pinned = false, tags = [] } = payload;
  if (!filePath) return null;

  const tagItems = (Array.isArray(tags) ? tags : []).map((tag) => ({
    label: `Remove Tag “${tag}”`,
    click: (done) => done({ action: 'remove-tag', tag }),
  }));

  return popupMenuAtCursor(event, [
    {
      label: pinned ? 'Unpin' : 'Pin',
      accelerator: 'CmdOrCtrl+Shift+P',
      click: (done) => done({ action: 'pin' }),
    },
    {
      label: 'Rename…',
      accelerator: 'F2',
      click: (done) => done({ action: 'rename' }),
    },
    { type: 'separator' },
    {
      label: 'Add Tag…',
      accelerator: 'CmdOrCtrl+E',
      click: (done) => done({ action: 'add-tag' }),
    },
    ...tagItems,
  ]);
});

ipcMain.handle('show-tag-context-menu', async (event, payload = {}) => {
  const { tag } = payload;
  if (!tag) return null;

  return popupMenuAtCursor(event, [
    {
      label: `Remove “${tag}”`,
      click: (done) => done({ action: 'remove', tag }),
    },
  ]);
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

ipcMain.handle('get-system-fonts', async () => getSystemFonts());

ipcMain.handle('watch-folder', async (_event, folderPath) => {
  if (!folderPath) return { success: false };
  return { success: folderWatch.watch(folderPath) };
});

ipcMain.handle('unwatch-folder', async () => {
  folderWatch.stop();
  return { success: true };
});

ipcMain.handle('resolve-image-path', async (_event, markdownFilePath, src) => {
  if (!markdownFilePath || !src) return null;

  const href = src.trim();
  if (/^(data:|file:|mailto:)/i.test(href)) return href;
  // Remote images are blocked by CSP by default; do not resolve http(s) to file URLs.
  if (/^https?:\/\//i.test(href)) return null;

  const baseDir = path.resolve(path.dirname(markdownFilePath));
  const withoutHash = href.split('#')[0].split('?')[0];
  const absolutePath = path.resolve(baseDir, withoutHash);
  const relative = path.relative(baseDir, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;

  try {
    const stat = await fsp.stat(absolutePath);
    if (!stat.isFile()) return null;
    return pathToFileURL(absolutePath).href;
  } catch {
    return null;
  }
});

ipcMain.handle('confirm-quit', async () => {
  rendererDirty = false;
  isQuitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  app.quit();
  return { success: true };
});

ipcMain.handle('cancel-quit', async () => {
  isQuitting = false;
  return { success: true };
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

app.on('before-quit', (event) => {
  if (isQuitting || !rendererDirty) {
    isQuitting = true;
    return;
  }
  event.preventDefault();
  if (!mainWindow || mainWindow.isDestroyed()) {
    isQuitting = true;
    app.exit(0);
    return;
  }
  // Reuse the window close flow so Save / Don't Save / Cancel is shown once.
  mainWindow.close();
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
