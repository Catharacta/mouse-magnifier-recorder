const { app, BrowserWindow, ipcMain, desktopCapturer, dialog, Tray, Menu, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let overlayWindow = null;
let tray = null;

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  overlayWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // 開発ツールはデバッグ時のみ有効化
  // overlayWindow.webContents.openDevTools({ mode: 'detach' });

  // 初期状態は非表示（ショートカットで表示）
  overlayWindow.hide();
}

function createTray() {
  const iconPath = path.join(__dirname, '../../resources/icon.png');
  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: '録画開始/停止 (Ctrl+Shift+R)', click: toggleRecordingState },
    { type: 'separator' },
    { label: '終了', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('Mouse Magnifier Recorder');
  tray.setContextMenu(contextMenu);
}

let cursorInterval = null;

function toggleRecordingState() {
  if (!overlayWindow) return;

  if (overlayWindow.isVisible()) {
    // 表示中なら、Rendererに何らかのシグナルを送る
    // ここでは単純に「表示切替」ではなく「録画モード開始」のトリガーとする
    overlayWindow.webContents.send('trigger-action', 'toggle-recording');
    if (cursorInterval) {
      clearInterval(cursorInterval);
      cursorInterval = null;
    }
  } else {
    // 非表示なら、範囲選択モードとして表示
    overlayWindow.show();
    overlayWindow.setIgnoreMouseEvents(false); // マウス操作を受け付ける（範囲選択のため）
    overlayWindow.webContents.send('trigger-action', 'start-selection');
    // 最前面を強制
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');

    // カーソル位置送信ループの開始 (録画開始時、または選択モード開始時)
    if (!cursorInterval) {
      cursorInterval = setInterval(() => {
        if (overlayWindow && overlayWindow.isVisible()) {
          const point = screen.getCursorScreenPoint();
          overlayWindow.webContents.send('cursor-update', point);
        }
      }, 33); // 約 30fps
    }
  }
}

app.whenReady().then(() => {
  // 開発用に少し遅延させてから起動（ファイルロック回避のまじない）
  setTimeout(() => {
    createOverlayWindow();
    createTray();

    // グローバルショートカット登録
    globalShortcut.register('Ctrl+Shift+R', toggleRecordingState);

    // ズームショートカット (Ctrl+Shift+Up/Down)
    globalShortcut.register('Ctrl+Shift+Up', () => overlayWindow?.webContents.send('zoom-action', 'in'));
    globalShortcut.register('Ctrl+Shift+Down', () => overlayWindow?.webContents.send('zoom-action', 'out'));
  }, 500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createOverlayWindow();
  });
});

app.on('window-all-closed', () => {
  // タスクトレイ常駐のため、アプリは終了させない
  if (app.isQuitting) {
    app.quit();
  }
});

// アプリ終了前のフック
app.on('before-quit', () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
});

// IPC Handlers
ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  return sources.map(source => ({
    id: source.id,
    name: source.name,
    thumbnailUrl: source.thumbnail.toDataURL(),
  }));
});

ipcMain.handle('save-video', async (event, { filePath, buffer }) => {
  const path = filePath;
  try {
    fs.writeFileSync(path, Buffer.from(buffer));
    return { success: true };
  } catch (e) {
    console.error(e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('save-metadata', async (event, { filePath, metadata }) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));
    return { success: true };
  } catch (e) {
    console.error(e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setIgnoreMouseEvents(ignore, options);
});

ipcMain.handle('reset-app', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;

  if (cursorInterval) {
    clearInterval(cursorInterval);
    cursorInterval = null;
  }

  win.hide();
  win.setFullScreen(true);
  // win.setTransparent(true); // 実行時に変更不可
  win.setBackgroundColor('#00000000'); // アルファ値を0にして透明にする
  // win.setFrame(false); // 実行時に変更不可
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setSkipTaskbar(true);
  win.setIgnoreMouseEvents(false);
});

ipcMain.handle('resize-window-to-editor', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.setFullScreen(false);
  // win.setTransparent(false); // method does not exist
  // win.setFrame(true); // method does not exist dynamic update not supported well
  win.setBackgroundColor('#2d2d2d'); // 背景色をセットして不透明っぽくする
  win.setSize(1280, 800);
  win.center();
  win.setAlwaysOnTop(false);
  win.setSkipTaskbar(false);
});

// エディタ終了時にオーバーレイに戻す、あるいはアプリ終了するかの制御
// 今回は「エディタを閉じたら非表示（タスクトレイ待機）に戻る」挙動が自然
app.on('browser-window-created', (e, win) => {
  win.on('close', (event) => {
    if (!app.isQuitting && win === overlayWindow) {
      event.preventDefault();
      win.hide();
      // オーバーレイ状態にリセット
      win.setFullScreen(true);
      win.setTransparent(true);
      win.setFrame(false);
      win.setAlwaysOnTop(true);
      win.setSkipTaskbar(true);
      win.setIgnoreMouseEvents(false); // 次回の選択のために戻しておく
      return false;
    }
  });
});
