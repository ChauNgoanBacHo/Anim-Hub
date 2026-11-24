import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('spinePreview', {
  appUpdateState: () => ipcRenderer.invoke('app-update-state'),
  installAppUpdate: () => ipcRenderer.invoke('install-app-update'),
  onAppUpdateState: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('app-update-state', listener);
    return () => ipcRenderer.removeListener('app-update-state', listener);
  },
  checkAppUpdate: () => ipcRenderer.invoke('check-app-update'),
  downloadAppUpdate: () => ipcRenderer.invoke('download-app-update'),
  onCatalogScanProgress: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('catalog-scan-progress', listener);
    return () => ipcRenderer.removeListener('catalog-scan-progress', listener);
  },
  animationNotes: (action, payload) => ipcRenderer.invoke('animation-notes', action, payload),
  onAnimationNotesProgress: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('animation-notes-progress', listener);
    return () => ipcRenderer.removeListener('animation-notes-progress', listener);
  },
  scanUploadGifs: (folder) => ipcRenderer.invoke('scan-upload-gifs', folder),
  browseDriveFolders: (payload) => ipcRenderer.invoke('workspace-browse-folders', payload),
  moveSheetToFolder: (payload) => ipcRenderer.invoke('workspace-move-sheet', payload),
  transferOwnership: (payload) => ipcRenderer.invoke('workspace-transfer-owner', payload),
  cancelTransferOwnership: () => ipcRenderer.invoke('workspace-cancel-transfer-owner'),
  assetBaseUrl: () => ipcRenderer.invoke('asset-base-url'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  scanFolder: (folderPath) => ipcRenderer.invoke('scan-spine-folder', folderPath),
  scanLocalCatalog: (folderPath, options) => ipcRenderer.invoke('scan-local-catalog', folderPath, options),
  scanNamingIssues: (folderPath) => ipcRenderer.invoke('scan-naming-issues', folderPath),
  selectExportFolder: () => ipcRenderer.invoke('select-export-folder'),
  saveBatchGifs: (payload) => ipcRenderer.invoke('save-batch-gifs', payload),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  openSheetLink: (url) => ipcRenderer.invoke('open-sheet-link', url),
  googleStatus: () => ipcRenderer.invoke('workspace-google-status'),
  googleSignIn: () => ipcRenderer.invoke('workspace-google-sign-in'),
  googleSignOut: () => ipcRenderer.invoke('workspace-google-sign-out'),
  createCatalog: (sheetUrl, catalog, operationId) => ipcRenderer.invoke('workspace-create-catalog', sheetUrl, catalog, operationId),
  cancelCatalog: (id) => ipcRenderer.invoke('workspace-cancel-catalog', id),
  finishCatalog: (id) => ipcRenderer.invoke('workspace-finish-catalog', id),
  loadClosureSheet: (sheetUrl, tabTitle) => ipcRenderer.invoke('workspace-load-sheet', sheetUrl, tabTitle),
  clearCatalog: () => ipcRenderer.invoke('workspace-clear-catalog'),
  queueImages: (payload) => ipcRenderer.invoke('workspace-queue-images', payload),
  queueStatus: (jobId, spreadsheetId) => ipcRenderer.invoke('workspace-queue-status', jobId, spreadsheetId),
});
