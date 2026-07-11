const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
  saveFileDialog: (options) => ipcRenderer.invoke('save-file-dialog', options),
  createFile: (options) => ipcRenderer.invoke('create-file', options),
  renameFile: (options) => ipcRenderer.invoke('rename-file', options),
  updateFileMeta: (options) => ipcRenderer.invoke('update-file-meta', options),
  showFileContextMenu: (options) => ipcRenderer.invoke('show-file-context-menu', options),
  showTagContextMenu: (options) => ipcRenderer.invoke('show-tag-context-menu', options),
  listFolder: (folderPath) => ipcRenderer.invoke('list-folder', folderPath),
  pathExists: (targetPath) => ipcRenderer.invoke('path-exists', targetPath),
  watchFolder: (folderPath) => ipcRenderer.invoke('watch-folder', folderPath),
  unwatchFolder: () => ipcRenderer.invoke('unwatch-folder'),
  getSystemFonts: () => ipcRenderer.invoke('get-system-fonts'),
  resolveImagePath: (markdownFilePath, src) =>
    ipcRenderer.invoke('resolve-image-path', markdownFilePath, src),

  onMenuNewFile: (callback) => ipcRenderer.on('menu-new-file', callback),
  onMenuOpenFile: (callback) => ipcRenderer.on('menu-open-file', callback),
  onMenuOpenFolder: (callback) => ipcRenderer.on('menu-open-folder', callback),
  onMenuSave: (callback) => ipcRenderer.on('menu-save', callback),
  onMenuSaveAs: (callback) => ipcRenderer.on('menu-save-as', callback),
  onMenuCloseFile: (callback) => ipcRenderer.on('menu-close-file', callback),
  onMenuRenameFile: (callback) => ipcRenderer.on('menu-rename-file', callback),
  onMenuTogglePin: (callback) => ipcRenderer.on('menu-toggle-pin', callback),
  onMenuAddTag: (callback) => ipcRenderer.on('menu-add-tag', callback),
  onMenuToggleSidebar: (callback) => ipcRenderer.on('menu-toggle-sidebar', callback),
  onMenuFind: (callback) => ipcRenderer.on('menu-find', callback),
  onMenuFocusFilter: (callback) => ipcRenderer.on('menu-focus-filter', callback),
  onMenuSettings: (callback) => ipcRenderer.on('menu-settings', callback),
  onOpenFilePath: (callback) => ipcRenderer.on('open-file-path', (_event, filePath) => callback(filePath)),
  onFolderChanged: (callback) =>
    ipcRenderer.on('folder-changed', (_event, payload) => callback(payload)),
  onFontsUpdated: (callback) =>
    ipcRenderer.on('fonts-updated', (_event, fonts) => callback(fonts)),
});
