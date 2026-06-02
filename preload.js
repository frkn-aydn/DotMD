const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
  listFolder: (folderPath) => ipcRenderer.invoke('list-folder', folderPath),
  resolveImagePath: (markdownFilePath, src) =>
    ipcRenderer.invoke('resolve-image-path', markdownFilePath, src),

  onMenuOpenFile: (callback) => ipcRenderer.on('menu-open-file', callback),
  onMenuOpenFolder: (callback) => ipcRenderer.on('menu-open-folder', callback),
  onMenuSave: (callback) => ipcRenderer.on('menu-save', callback),
  onMenuCloseFile: (callback) => ipcRenderer.on('menu-close-file', callback),
  onOpenFilePath: (callback) => ipcRenderer.on('open-file-path', (_event, filePath) => callback(filePath)),
});
