const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getSources: () => ipcRenderer.invoke('get-sources'),
    saveVideo: (data) => ipcRenderer.invoke('save-video', data),
    saveMetadata: (data) => ipcRenderer.invoke('save-metadata', data),
});
