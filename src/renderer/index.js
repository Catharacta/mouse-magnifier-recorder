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
        const buffer = await blob.arrayBuffer();

        // とりあえずプロジェクトルートに保存
        const timestamp = Date.now();
        await window.electronAPI.saveVideo({
            filePath: `raw_video_${timestamp}.webm`,
            buffer: buffer
        });

        await window.electronAPI.saveMetadata({
            filePath: `metadata_${timestamp}.json`,
            metadata: {
                startTime: startTime,
                duration: Date.now() - startTime,
                events: zoomEvents
            }
        });

        alert('録画が保存されました');
        resetUI();
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
