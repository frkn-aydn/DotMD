const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
  listFolder: (folderPath) => ipcRenderer.invoke('list-folder', folderPath),
  watchFolder: (folderPath) => ipcRenderer.invoke('watch-folder', folderPath),
  unwatchFolder: () => ipcRenderer.invoke('unwatch-folder'),
  getSystemFonts: () => ipcRenderer.invoke('get-system-fonts'),
  resolveImagePath: (markdownFilePath, src) =>
    ipcRenderer.invoke('resolve-image-path', markdownFilePath, src),

  onMenuOpenFile: (callback) => ipcRenderer.on('menu-open-file', callback),
  onMenuOpenFolder: (callback) => ipcRenderer.on('menu-open-folder', callback),
  onMenuSave: (callback) => ipcRenderer.on('menu-save', callback),
  onMenuCloseFile: (callback) => ipcRenderer.on('menu-close-file', callback),
  onMenuToggleSidebar: (callback) => ipcRenderer.on('menu-toggle-sidebar', callback),
  onMenuFind: (callback) => ipcRenderer.on('menu-find', callback),
  onMenuSettings: (callback) => ipcRenderer.on('menu-settings', callback),
  onOpenFilePath: (callback) => ipcRenderer.on('open-file-path', (_event, filePath) => callback(filePath)),
  onFolderChanged: (callback) =>
    ipcRenderer.on('folder-changed', (_event, payload) => callback(payload)),
  onFontsUpdated: (callback) =>
    ipcRenderer.on('fonts-updated', (_event, fonts) => callback(fonts)),
});
