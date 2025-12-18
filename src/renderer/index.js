// --- Constants ---
const DPR = window.devicePixelRatio || 1;

// --- Elements ---
const selectionLayer = document.getElementById('selection-layer');
const selectionCanvas = document.getElementById('selection-canvas');
const selCtx = selectionCanvas.getContext('2d');

const countdownOverlay = document.getElementById('countdown-overlay');
const countdownNumber = document.getElementById('countdown-number');
const preRecordDialog = document.getElementById('pre-record-dialog');
const startRecordBtn = document.getElementById('start-record-btn');
const cancelSelectionBtn = document.getElementById('cancel-selection-btn');

const recordingHud = document.getElementById('recording-hud');
const hudTimer = document.getElementById('hud-timer');
const hudScale = document.getElementById('hud-scale');

const editorSection = document.getElementById('editor-section');
const editorCanvas = document.getElementById('editor-canvas');
const editorCtx = editorCanvas.getContext('2d');
const playPauseBtn = document.getElementById('play-pause-btn');
const currentTimeDisplay = document.getElementById('current-time');
const eventList = document.getElementById('event-list');
const eventEditor = document.getElementById('event-editor');
const exportBtn = document.getElementById('export-btn');
const discardBtn = document.getElementById('discard-btn');
const exportProgressContainer = document.getElementById('export-progress-container');
const exportProgress = document.getElementById('export-progress');
const exportStatus = document.getElementById('export-status');

// --- State ---
let isSelecting = false;
let isRecording = false;
let startPos = { x: 0, y: 0 };
let cropRect = { x: 0, y: 0, width: 0, height: 0 }; // CSS Pixels

let mediaRecorder;
let recordedChunks = [];
let zoomEvents = [];
let currentScale = 1.0;
let currentCursor = { x: 0, y: 0 }; // Screen Point (CSS Pixels)
let startTime;
let timerInterval;

let currentVideoElement = document.createElement('video');
let isPlaying = false;
let selectedEventIndex = -1;

// --- Initialization ---
function resizeSelectionCanvas() {
    selectionCanvas.width = window.innerWidth * DPR;
    selectionCanvas.height = window.innerHeight * DPR;
    selectionCanvas.style.width = window.innerWidth + 'px';
    selectionCanvas.style.height = window.innerHeight + 'px';
    selCtx.scale(DPR, DPR);
    if (isRecording) drawRecordingBoundary();
}
window.addEventListener('resize', resizeSelectionCanvas);
resizeSelectionCanvas();

// --- IPC Listeners ---
window.electronAPI.onTriggerAction((action) => {
    if (action === 'start-selection') {
        startSelectionMode();
    } else if (action === 'toggle-recording') {
        if (isRecording) {
            stopRecording();
        } else {
            startSelectionMode();
        }
    }
});

window.electronAPI.onCursorUpdate((point) => {
    currentCursor = point;
});

window.electronAPI.onZoomAction((direction) => {
    if (!isRecording) return;

    // スケール変更 (0.2刻み)
    const delta = direction === 'in' ? 0.2 : -0.2;
    currentScale = Math.min(Math.max(1.0, currentScale + delta), 5.0);

    const elapsedTime = Date.now() - startTime;

    // クロップ領域相対座標 (CSS Pixels)
    const center = {
        x: currentCursor.x - cropRect.x,
        y: currentCursor.y - cropRect.y
    };

    const event = {
        time_ms: elapsedTime,
        center: center,
        scale: parseFloat(currentScale.toFixed(2)),
        type: 'zoom'
    };

    // 頻繁な記録を制限
    if (zoomEvents.length > 0) {
        const last = zoomEvents[zoomEvents.length - 1];
        if (Math.abs(last.time_ms - event.time_ms) < 33) {
            zoomEvents[zoomEvents.length - 1] = event;
        } else {
            zoomEvents.push(event);
        }
    } else {
        zoomEvents.push(event);
    }

    hudScale.innerText = `Zoom: ${event.scale}x`;
});

// --- Selection Logic ---
function startSelectionMode() {
    if (isRecording) return;
    selectionLayer.classList.remove('hidden');
    preRecordDialog.classList.add('hidden');
    countdownOverlay.classList.add('hidden');
    editorSection.classList.add('hidden');
    recordingHud.classList.add('hidden');
    document.body.classList.remove('editor-mode');

    window.electronAPI.setIgnoreMouseEvents(false);

    selCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
}

selectionCanvas.addEventListener('mousedown', (e) => {
    if (isRecording) return;
    isSelecting = true;
    startPos = { x: e.clientX, y: e.clientY };
    cropRect = { x: e.clientX, y: e.clientY, width: 0, height: 0 };
});

selectionCanvas.addEventListener('mousemove', (e) => {
    if (!isSelecting) return;
    const currentX = e.clientX;
    const currentY = e.clientY;

    const width = currentX - startPos.x;
    const height = currentY - startPos.y;

    cropRect = {
        x: width > 0 ? startPos.x : currentX,
        y: height > 0 ? startPos.y : currentY,
        width: Math.abs(width),
        height: Math.abs(height)
    };

    drawSelection();
});

selectionCanvas.addEventListener('mouseup', () => {
    isSelecting = false;
    if (cropRect.width > 20 && cropRect.height > 20) {
        // 範囲選択完了 -> ダイアログを表示
        showPreRecordDialog();
    } else {
        selCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
    }
});

function showPreRecordDialog() {
    preRecordDialog.classList.remove('hidden');
}

cancelSelectionBtn.onclick = () => {
    startSelectionMode();
};

startRecordBtn.onclick = async () => {
    preRecordDialog.classList.add('hidden');
    await startCountdown();
};

async function startCountdown() {
    countdownOverlay.classList.remove('hidden');
    for (let i = 3; i > 0; i--) {
        countdownNumber.innerText = i;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    countdownOverlay.classList.add('hidden');
    startRecordingProcess();
}

function drawSelection() {
    selCtx.clearRect(0, 0, selectionCanvas.width / DPR, selectionCanvas.height / DPR);
    selCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    selCtx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    selCtx.globalCompositeOperation = 'destination-out';
    selCtx.fillStyle = 'black';
    selCtx.fillRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);

    selCtx.globalCompositeOperation = 'source-over';
    selCtx.strokeStyle = '#f49d37';
    selCtx.lineWidth = 3;
    selCtx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
}

function drawRecordingBoundary() {
    selCtx.clearRect(0, 0, selectionCanvas.width / DPR, selectionCanvas.height / DPR);
    selCtx.strokeStyle = '#f49d37';
    selCtx.lineWidth = 4;
    selCtx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
}

// --- Recording Logic ---
async function startRecordingProcess() {
    drawRecordingBoundary();
    recordingHud.classList.remove('hidden');

    await window.electronAPI.setIgnoreMouseEvents(true, { forward: true });

    try {
        const sources = await window.electronAPI.getSources();
        const source = sources[0];

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: source.id,
                    minWidth: 1920,
                    maxWidth: 3840,
                    minHeight: 1080,
                    maxHeight: 2160
                }
            }
        });

        mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'video/webm; codecs=vp9'
        });

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = getOnStopHandler();

        recordedChunks = [];
        zoomEvents = [];
        currentScale = 1.0;

        // 初期状態を記録
        zoomEvents.push({
            time_ms: 0,
            center: { x: cropRect.width / 2, y: cropRect.height / 2 },
            scale: 1.0
        });

        startTime = Date.now();
        mediaRecorder.start();
        isRecording = true;
        startTimer();
        hudScale.innerText = "Zoom: 1.0x";

    } catch (e) {
        console.error(e);
        alert('録画開始に失敗しました');
        location.reload();
    }
}

function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    mediaRecorder.stop();
    stopTimer();
    isRecording = false;
    window.electronAPI.setIgnoreMouseEvents(false);
    selectionLayer.classList.add('hidden');
}

function startTimer() {
    hudTimer.innerText = "00:00";
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        hudTimer.innerText = `${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
}

function getOnStopHandler() {
    return async () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        showEditor(blob);
    };
}

// --- Editor Logic ---
function showEditor(blob) {
    window.electronAPI.resizeWindowToEditor();

    recordingHud.classList.add('hidden');
    editorSection.classList.remove('hidden');
    document.body.classList.add('editor-mode');

    currentVideoElement.src = URL.createObjectURL(blob);
    currentVideoElement.onloadedmetadata = () => {
        updateTimeline();
        renderFrame();
    };
}

discardBtn.onclick = async () => {
    if (confirm('録画を破棄してよろしいですか？')) {
        await window.electronAPI.resetApp();
        location.reload();
    }
};

function updateTimeline() {
    eventList.innerHTML = '';
    const sorted = [...zoomEvents].sort((a, b) => a.time_ms - b.time_ms);
    sorted.forEach((event, index) => {
        const div = document.createElement('div');
        div.className = `event-item ${event === zoomEvents[selectedEventIndex] ? 'selected' : ''}`;
        div.innerHTML = `<span>${(event.time_ms / 1000).toFixed(2)}s</span>: Zoom ${event.scale}x`;
        div.onclick = () => selectEvent(zoomEvents.indexOf(event));
        eventList.appendChild(div);
    });
}

function selectEvent(index) {
    selectedEventIndex = index;
    const event = zoomEvents[index];
    eventEditor.classList.remove('hidden');
    document.getElementById('prop-time').value = Math.round(event.time_ms);
    document.getElementById('prop-scale').value = event.scale;
    document.getElementById('prop-x').value = Math.round(event.center.x);
    document.getElementById('prop-y').value = Math.round(event.center.y);
    currentVideoElement.currentTime = event.time_ms / 1000;
    updateTimeline();
}

document.getElementById('save-event-btn').onclick = () => {
    if (selectedEventIndex === -1) return;
    const event = zoomEvents[selectedEventIndex];
    event.time_ms = parseInt(document.getElementById('prop-time').value);
    event.scale = parseFloat(document.getElementById('prop-scale').value);
    event.center.x = parseInt(document.getElementById('prop-x').value);
    event.center.y = parseInt(document.getElementById('prop-y').value);
    updateTimeline();
    renderFrame();
};

document.getElementById('delete-event-btn').onclick = () => {
    if (selectedEventIndex <= 0) return;
    zoomEvents.splice(selectedEventIndex, 1);
    selectedEventIndex = -1;
    eventEditor.classList.add('hidden');
    updateTimeline();
    renderFrame();
};

playPauseBtn.onclick = () => {
    if (isPlaying) {
        currentVideoElement.pause();
        playPauseBtn.innerText = '再生';
    } else {
        currentVideoElement.play();
        playPauseBtn.innerText = '停止';
    }
    isPlaying = !isPlaying;
};

currentVideoElement.ontimeupdate = () => {
    const cur = currentVideoElement.currentTime;
    const dur = currentVideoElement.duration;
    currentTimeDisplay.innerText = `${formatTime(cur)} / ${formatTime(dur)}`;
    if (!isPlaying) renderFrame();
};

function formatTime(seconds) {
    if (isNaN(seconds)) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderLoop() {
    if (isPlaying) renderFrame();
    requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

// --- 描画ロジック (DPR & Clipping) ---
function getInterpolatedState(timeMs) {
    if (zoomEvents.length === 0) return { scale: 1.0, center: { x: cropRect.width / 2, y: cropRect.height / 2 } };

    const sorted = [...zoomEvents].sort((a, b) => a.time_ms - b.time_ms);
    let prev = sorted[0];
    let next = null;

    for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].time_ms <= timeMs) {
            prev = sorted[i];
        } else {
            next = sorted[i];
            break;
        }
    }

    if (!next) return { scale: prev.scale, center: prev.center };
    if (prev.scale === next.scale && prev.center.x === next.center.x && prev.center.y === next.center.y) {
        return { scale: prev.scale, center: prev.center };
    }

    const ratio = (timeMs - prev.time_ms) / (next.time_ms - prev.time_ms);
    return {
        scale: prev.scale + (next.scale - prev.scale) * ratio,
        center: {
            x: prev.center.x + (next.center.x - prev.center.x) * ratio,
            y: prev.center.y + (next.center.y - prev.center.y) * ratio
        }
    };
}

function renderFrame() {
    if (!currentVideoElement.videoWidth) return;

    const currentTimeMs = currentVideoElement.currentTime * 1000;
    const state = getInterpolatedState(currentTimeMs);

    editorCtx.fillStyle = 'black';
    editorCtx.fillRect(0, 0, editorCanvas.width, editorCanvas.height);

    // ソースビデオ内の物理ピクセル座標
    const viewWidthPx = (cropRect.width * DPR) / state.scale;
    const viewHeightPx = (cropRect.height * DPR) / state.scale;
    const centerX_abs_Px = (cropRect.x + state.center.x) * DPR;
    const centerY_abs_Px = (cropRect.y + state.center.y) * DPR;

    const sx = centerX_abs_Px - viewWidthPx / 2;
    const sy = centerY_abs_Px - viewHeightPx / 2;

    const dstW = editorCanvas.width;
    const dstH = editorCanvas.height;
    const srcAspect = cropRect.width / cropRect.height;
    const dstAspect = dstW / dstH;

    let drawW, drawH, drawX, drawY;
    if (srcAspect > dstAspect) {
        drawW = dstW;
        drawH = dstW / srcAspect;
        drawX = 0;
        drawY = (dstH - drawH) / 2;
    } else {
        drawH = dstH;
        drawW = dstH * srcAspect;
        drawY = 0;
        drawX = (dstW - drawW) / 2;
    }

    try {
        editorCtx.drawImage(
            currentVideoElement,
            sx, sy, viewWidthPx, viewHeightPx,
            drawX, drawY, drawW, drawH
        );
    } catch (e) { }
}

// --- 高精度エクスポートロジック (MediaRecorder + Seek Loop) ---
exportBtn.onclick = async () => {
    if (!cropRect || cropRect.width === 0) return;
    if (!currentVideoElement.duration) return;

    exportBtn.disabled = true;
    exportProgressContainer.classList.remove('hidden');
    exportStatus.innerText = "Initializing encoder...";

    const exportWidth = Math.floor(cropRect.width * DPR / 2) * 2;
    const exportHeight = Math.floor(cropRect.height * DPR / 2) * 2;

    const offscreen = new OffscreenCanvas(exportWidth, exportHeight);
    const osCtx = offscreen.getContext('2d');

    // captureStream(0) ではなく固定FPS(30)を指定し、手動で requestFrame を呼ぶことで同期をとる
    const stream = offscreen.captureStream(30);
    const videoTrack = stream.getVideoTracks()[0];
    const recorder = new MediaRecorder(stream, {
        mimeType: 'video/webm; codecs=vp9',
        videoBitsPerSecond: 10000000 // 10Mbps
    });

    const chunks = [];
    recorder.ondataavailable = e => {
        if (e.data.size > 0) chunks.push(e.data);
    };

    const duration = currentVideoElement.duration;

    const donePromise = new Promise((resolve) => {
        recorder.onstop = async () => {
            exportStatus.innerText = "Saving file...";
            const blob = new Blob(chunks, { type: 'video/webm' });
            const buffer = await blob.arrayBuffer();
            await window.electronAPI.saveVideo({
                filePath: `MMR_Export_${Date.now()}.webm`,
                buffer: buffer
            });
            resolve();
        };
    });

    recorder.start();

    let currentTime = 0;
    const fps = 30;
    const frameTime = 1 / fps;

    while (currentTime <= duration) {
        const progress = (currentTime / duration) * 100;
        exportProgress.style.width = `${progress}%`;
        exportStatus.innerText = `Rendering: ${Math.round(progress)}%`;

        currentVideoElement.currentTime = currentTime;

        // シーク完了を待つ (Promise + EventListener)
        await new Promise((resolve) => {
            const onSeeked = () => {
                currentVideoElement.removeEventListener('seeked', onSeeked);
                resolve();
            };
            currentVideoElement.addEventListener('seeked', onSeeked);
            setTimeout(resolve, 800); // 念のためのセーフティネット
        });

        // 描画
        const state = getInterpolatedState(currentTime * 1000);
        const viewWidthPx = (cropRect.width * DPR) / state.scale;
        const viewHeightPx = (cropRect.height * DPR) / state.scale;
        const centerX_abs_Px = (cropRect.x + state.center.x) * DPR;
        const centerY_abs_Px = (cropRect.y + state.center.y) * DPR;

        const sx = centerX_abs_Px - viewWidthPx / 2;
        const sy = centerY_abs_Px - viewHeightPx / 2;

        osCtx.fillStyle = 'black';
        osCtx.fillRect(0, 0, exportWidth, exportHeight);
        try {
            // ここで clipping が正常に機能するように sx, sy, sw, sh を物理ピクセルで指定
            osCtx.drawImage(
                currentVideoElement,
                sx, sy, viewWidthPx, viewHeightPx,
                0, 0, exportWidth, exportHeight
            );
        } catch (e) { }

        // フレームをプッシュ
        if (videoTrack.requestFrame) {
            videoTrack.requestFrame();
        }

        currentTime += frameTime;
        await new Promise(r => setTimeout(r, 10)); // イベントループを回す
    }

    // 最後に短いディレイを入れてから停止（最後のフレームを確実にキャプチャするため）
    await new Promise(r => setTimeout(r, 500));
    recorder.stop();
    await donePromise;

    exportStatus.innerText = "Complete!";
    exportProgress.style.width = "100%";
    alert('エクスポートが完了しました。');
    exportBtn.disabled = false;
    setTimeout(() => exportProgressContainer.classList.add('hidden'), 3000);
};
