const { app, BrowserWindow, dialog, ipcMain, Menu, shell, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const { pathToFileURL } = require('url');

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

const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd)$/i;

function isMarkdownFile(filePath) {
  return MARKDOWN_EXT.test(filePath);
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
        { label: 'Open File…', accelerator: 'CmdOrCtrl+O', click: send('menu-open-file') },
        { label: 'New / Open File…', accelerator: 'CmdOrCtrl+T', click: send('menu-open-file') },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: send('menu-open-folder') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('menu-save') },
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
    if (!/\.(md|markdown|mdown|mkd)$/i.test(entry.name)) continue;

    items.push({ name: entry.name, path: path.join(dirPath, entry.name), type: 'file' });
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

ipcMain.handle('list-folder', async (_event, folderPath) => {
  return readDirectory(folderPath);
});

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
  createWindow();
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
