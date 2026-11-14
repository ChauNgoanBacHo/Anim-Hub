import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('spinePreview', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  scanFolder: (folderPath) => ipcRenderer.invoke('scan-spine-folder', folderPath),
  scanLocalCatalog: (folderPath) => ipcRenderer.invoke('scan-local-catalog', folderPath),
  scanNamingIssues: (folderPath) => ipcRenderer.invoke('scan-naming-issues', folderPath),
  selectExportFolder: () => ipcRenderer.invoke('select-export-folder'),
  saveBatchGifs: (payload) => ipcRenderer.invoke('save-batch-gifs', payload),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  openSheetLink: (url) => ipcRenderer.invoke('open-sheet-link', url),
  googleStatus: () => ipcRenderer.invoke('workspace-google-status'),
  googleSignIn: () => ipcRenderer.invoke('workspace-google-sign-in'),
  googleSignOut: () => ipcRenderer.invoke('workspace-google-sign-out'),
  createCatalog: (sheetUrl, catalog) => ipcRenderer.invoke('workspace-create-catalog', sheetUrl, catalog),
  loadClosureSheet: (sheetUrl, tabTitle) => ipcRenderer.invoke('workspace-load-sheet', sheetUrl, tabTitle),
  clearCatalog: () => ipcRenderer.invoke('workspace-clear-catalog'),
  queueImages: (payload) => ipcRenderer.invoke('workspace-queue-images', payload),
  queueStatus: (jobId, spreadsheetId) => ipcRenderer.invoke('workspace-queue-status', jobId, spreadsheetId),
});
