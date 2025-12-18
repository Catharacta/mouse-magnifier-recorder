const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getSources: () => ipcRenderer.invoke('get-sources'),
    saveVideo: (data) => ipcRenderer.invoke('save-video', data),
    saveMetadata: (data) => ipcRenderer.invoke('save-metadata', data),
    setIgnoreMouseEvents: (ignore, options) => ipcRenderer.invoke('set-ignore-mouse-events', ignore, options),
    resizeWindowToEditor: () => ipcRenderer.invoke('resize-window-to-editor'),
    resetApp: () => ipcRenderer.invoke('reset-app'),
    onTriggerAction: (callback) => ipcRenderer.on('trigger-action', (_event, action) => callback(action)),
    onZoomAction: (callback) => ipcRenderer.on('zoom-action', (_event, direction) => callback(direction)),
    onCursorUpdate: (callback) => ipcRenderer.on('cursor-update', (_event, point) => callback(point))
});
