const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  
  // デバッグ用
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC ハンドラー: 録画ソース（画面/ウィンドウ）の取得
ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
  return sources.map(source => ({
    id: source.id,
    name: source.name,
    thumbnailUrl: source.thumbnail.toDataURL(),
  }));
});

// IPC ハンドラー: 動画データの保存
ipcMain.handle('save-video', async (event, { filePath, buffer }) => {
  try {
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return { success: true };
  } catch (error) {
    console.error('Failed to save video:', error);
    return { success: false, error: error.message };
  }
});

// IPC ハンドラー: メタデータの保存
ipcMain.handle('save-metadata', async (event, { filePath, metadata }) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));
    return { success: true };
  } catch (error) {
    console.error('Failed to save metadata:', error);
    return { success: false, error: error.message };
  }
});
