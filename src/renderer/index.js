let mediaRecorder;
let recordedChunks = [];
let zoomEvents = [];
let currentScale = 1.0;
let startTime;
let timerInterval;

const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const sourcesModal = document.getElementById('sources-modal');
const sourcesList = document.getElementById('sources-list');
const closeModalBtn = document.getElementById('close-modal-btn');
const previewVideo = document.getElementById('preview');
const hud = document.getElementById('hud');
const hudTimer = document.getElementById('hud-timer');
const hudScale = document.getElementById('hud-scale');

const recordingSection = document.getElementById('recording-section');
const editorSection = document.getElementById('editor-section');
const editorCanvas = document.getElementById('editor-canvas');
const ctx = editorCanvas.getContext('2d');
const playPauseBtn = document.getElementById('play-pause-btn');
const currentTimeDisplay = document.getElementById('current-time');
const eventList = document.getElementById('event-list');
const eventEditor = document.getElementById('event-editor');
const exportBtn = document.getElementById('export-btn');
const exportProgressContainer = document.getElementById('export-progress-container');
const exportProgress = document.getElementById('export-progress');

// 編集用ステート
let currentVideoBlob = null;
let currentVideoElement = document.createElement('video');
let isPlaying = false;
let selectedEventIndex = -1;

startBtn.onclick = async () => {
    const sources = await window.electronAPI.getSources();
    sourcesList.innerHTML = '';

    sources.forEach(source => {
        const div = document.createElement('div');
        div.className = 'source-item';
        div.innerHTML = `
            <img src="${source.thumbnailUrl}">
            <span>${source.name}</span>
        `;
        div.onclick = () => startRecording(source.id);
        sourcesList.appendChild(div);
    });

    sourcesModal.classList.remove('hidden');
};

closeModalBtn.onclick = () => {
    sourcesModal.classList.add('hidden');
};

async function startRecording(sourceId) {
    sourcesModal.classList.add('hidden');

    const stream = await navigator.mediaDevices.getUserMedia({
        audio: false, // PoCでは音声なし
        video: {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: sourceId,
                minWidth: 1920,
                maxWidth: 1920,
                minHeight: 1080,
                maxHeight: 1080,
                minFrameRate: 30,
                maxFrameRate: 30
            }
        }
    });

    previewVideo.srcObject = stream;

    mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm; codecs=vp9'
    });

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
            recordedChunks.push(e.data);
        }
    };

    mediaRecorder.onstop = async () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        currentVideoBlob = blob;
        const buffer = await blob.arrayBuffer();

        // 保存
        const timestamp = Date.now();
        const videoPath = `raw_video_${timestamp}.webm`;
        const metadataPath = `metadata_${timestamp}.json`;

        await window.electronAPI.saveVideo({ filePath: videoPath, buffer: buffer });
        await window.electronAPI.saveMetadata({
            filePath: metadataPath,
            metadata: { startTime, duration: Date.now() - startTime, events: zoomEvents }
        });

        // 編集モードへ移行
        showEditor(blob);
    };

    recordedChunks = [];
    zoomEvents = [];
    currentScale = 1.0;
    startTime = Date.now();

    mediaRecorder.start();

    startBtn.disabled = true;
    stopBtn.disabled = false;
    hud.classList.remove('hidden');

    startTimer();
}

stopBtn.onclick = () => {
    mediaRecorder.stop();
    stopTimer();
};

function resetUI() {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    hud.classList.add('hidden');
    previewVideo.srcObject = null;
}

// ズームイベントの記録
window.addEventListener('wheel', (e) => {
    if (e.ctrlKey && mediaRecorder && mediaRecorder.state === 'recording') {
        e.preventDefault();

        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        currentScale = Math.min(Math.max(1.0, currentScale + delta), 5.0);

        const event = {
            time_ms: Date.now() - startTime,
            center: { x: e.clientX, y: e.clientY }, // レンダラー上の座標（要正規化は将来）
            scale: parseFloat(currentScale.toFixed(2)),
            type: 'zoom'
        };

        zoomEvents.push(event);
        hudScale.innerText = `Zoom: ${event.scale}x`;
    }
}, { passive: false });

function startTimer() {
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

function showEditor(blob) {
    recordingSection.classList.add('hidden');
    editorSection.classList.remove('hidden');
    hud.classList.add('hidden');

    currentVideoElement.src = URL.createObjectURL(blob);
    currentVideoElement.onloadedmetadata = () => {
        updateTimeline();
        renderFrame();
    };
}

function updateTimeline() {
    eventList.innerHTML = '';
    zoomEvents.sort((a, b) => a.time_ms - b.time_ms).forEach((event, index) => {
        const div = document.createElement('div');
        div.className = `event-item ${index === selectedEventIndex ? 'selected' : ''}`;
        div.innerHTML = `<span>${(event.time_ms / 1000).toFixed(2)}s</span>: Zoom ${event.scale}x`;
        div.onclick = () => selectEvent(index);
        eventList.appendChild(div);
    });
}

function selectEvent(index) {
    selectedEventIndex = index;
    const event = zoomEvents[index];

    updateTimeline();
    eventEditor.classList.remove('hidden');

    document.getElementById('prop-time').value = event.time_ms;
    document.getElementById('prop-scale').value = event.scale;
    document.getElementById('prop-x').value = event.center.x;
    document.getElementById('prop-y').value = event.center.y;

    // イベントの時間へシーク
    currentVideoElement.currentTime = event.time_ms / 1000;
}

// プロパティ保存
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

// 削除
document.getElementById('delete-event-btn').onclick = () => {
    if (selectedEventIndex === -1) return;
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
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 描画ループ
function renderLoop() {
    if (isPlaying) {
        renderFrame();
    }
    requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

function renderFrame() {
    const currentTimeMs = currentVideoElement.currentTime * 1000;
    const state = getInterpolatedState(currentTimeMs);

    ctx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);

    if (state.scale > 1.0) {
        const sw = editorCanvas.width / state.scale;
        const sh = editorCanvas.height / state.scale;
        const sx = state.center.x - sw / 2;
        const sy = state.center.y - sh / 2;

        ctx.drawImage(currentVideoElement, sx, sy, sw, sh, 0, 0, editorCanvas.width, editorCanvas.height);
    } else {
        ctx.drawImage(currentVideoElement, 0, 0, editorCanvas.width, editorCanvas.height);
    }
}

// ズーム状態の補間
function getInterpolatedState(timeMs) {
    if (zoomEvents.length === 0) return { scale: 1.0, center: { x: 960, y: 540 } };

    const sorted = [...zoomEvents].sort((a, b) => a.time_ms - b.time_ms);

    // 現在時刻より前の最後のイベント
    let prev = null;
    let next = null;

    for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].time_ms <= timeMs) {
            prev = sorted[i];
        } else {
            next = sorted[i];
            break;
        }
    }

    if (!prev) return { scale: 1.0, center: { x: 960, y: 540 } }; // 開始前
    if (!next) return { scale: prev.scale, center: prev.center }; // 最後以降

    // 線形補間
    const ratio = (timeMs - prev.time_ms) / (next.time_ms - prev.time_ms);
    return {
        scale: prev.scale + (next.scale - prev.scale) * ratio,
        center: {
            x: prev.center.x + (next.center.x - prev.center.x) * ratio,
            y: prev.center.y + (next.center.y - prev.center.y) * ratio
        }
    };
}

// エクスポート
exportBtn.onclick = async () => {
    exportBtn.disabled = true;
    exportProgressContainer.classList.remove('hidden');

    const duration = currentVideoElement.duration;
    const offscreen = new OffscreenCanvas(1920, 1080);
    const osCtx = offscreen.getContext('2d');
    const stream = offscreen.captureStream(30);

    const recorder = new MediaRecorder(stream, {
        mimeType: 'video/webm; codecs=vp9'
    });

    const chunks = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const buffer = await blob.arrayBuffer();
        await window.electronAPI.saveVideo({
            filePath: `exported_${Date.now()}.webm`,
            buffer: buffer
        });
        alert('エクスポート完了');
        exportBtn.disabled = false;
        exportProgressContainer.classList.add('hidden');
    };

    recorder.start();

    // 等速再生しながらキャプチャ（簡易版）
    currentVideoElement.currentTime = 0;
    currentVideoElement.play();
    isPlaying = true;

    const interval = setInterval(() => {
        const progress = (currentVideoElement.currentTime / duration) * 100;
        exportProgress.style.width = `${progress}%`;

        // オフスクリーンに描画
        const state = getInterpolatedState(currentVideoElement.currentTime * 1000);
        osCtx.clearRect(0, 0, 1920, 1080);
        if (state.scale > 1.0) {
            const sw = 1920 / state.scale;
            const sh = 1080 / state.scale;
            const sx = state.center.x - sw / 2;
            const sy = state.center.y - sh / 2;
            osCtx.drawImage(currentVideoElement, sx, sy, sw, sh, 0, 0, 1920, 1080);
        } else {
            osCtx.drawImage(currentVideoElement, 0, 0, 1920, 1080);
        }

        if (currentVideoElement.ended) {
            clearInterval(interval);
            recorder.stop();
            isPlaying = false;
        }
    }, 1000 / 30);
};
