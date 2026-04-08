import './styles.css';
import { Sender } from './sender';
import { Receiver } from './receiver';
import { formatFileSize, TransferMetadata } from './protocol';
import jsQR from 'jsqr';
import { parseFeedback, getMissingChunks } from './feedback';

// ===== PWA: Service Worker Registration =====
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // SW registration failed — app still works without it
  });
}

// ===== DOM Elements =====
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const tabSend = $<HTMLButtonElement>('tab-send');
const tabReceive = $<HTMLButtonElement>('tab-receive');
const sendPanel = $('send-panel');
const receivePanel = $('receive-panel');

// Send mode toggle
const modeFile = $<HTMLButtonElement>('mode-file');
const modeText = $<HTMLButtonElement>('mode-text');
const textInputZone = $('text-input-zone');
const textInput = $<HTMLTextAreaElement>('text-input');
const textCharCount = $('text-char-count');
const btnGenerateQR = $<HTMLButtonElement>('btn-generate-qr');

// Send elements
const dropZone = $('drop-zone');
const fileInput = $<HTMLInputElement>('file-input');
const sendActive = $('send-active');
const fileName = $('file-name');
const fileSize = $('file-size');
const chunkCount = $('chunk-count');
const chunkSizeSlider = $<HTMLInputElement>('chunk-size');
const chunkSizeVal = $('chunk-size-val');
const speedSlider = $<HTMLInputElement>('speed');
const speedVal = $('speed-val');
const qrCanvas = $<HTMLCanvasElement>('qr-canvas');
const sendChunkGrid = $('send-chunk-grid');
const qrOverlay = $('qr-overlay');
const sendCurrent = $('send-current');
const sendTotal = $('send-total');
const sendProgress = $('send-progress');
const btnPrev = $<HTMLButtonElement>('btn-prev');
const btnPlay = $<HTMLButtonElement>('btn-play');
const btnNext = $<HTMLButtonElement>('btn-next');
const iconPlay = $('icon-play');
const iconPause = $('icon-pause');
const playLabel = $('play-label');

// Feedback scanner (sender)
const btnScanFeedback = $<HTMLButtonElement>('btn-scan-feedback');
const feedbackScanner = $('feedback-scanner');
const feedbackCamera = $<HTMLVideoElement>('feedback-camera');
const btnFlipFeedbackCam = $<HTMLButtonElement>('btn-flip-feedback-cam');
const feedbackScanCanvas = $<HTMLCanvasElement>('feedback-scan-canvas');
const btnCancelScan = $<HTMLButtonElement>('btn-cancel-scan');
const feedbackResult = $('feedback-result');

// Receive elements
const receiveIdle = $('receive-idle');
const receiveActive = $('receive-active');
const btnStartScan = $<HTMLButtonElement>('btn-start-scan');
const btnStopScan = $<HTMLButtonElement>('btn-stop-scan');
const btnResetScan = $<HTMLButtonElement>('btn-reset-scan');
const cameraVideo = $<HTMLVideoElement>('camera');
const scanCanvas = $<HTMLCanvasElement>('scan-canvas');
const scanIndicator = $('scan-indicator');
const recvInfo = $('recv-info');
const recvFilename = $('recv-filename');
const recvFilesize = $('recv-filesize');
const recvCurrent = $('recv-current');
const recvTotal = $('recv-total');
const recvProgress = $('recv-progress');
const chunkGrid = $('chunk-grid');
const receiveComplete = $('receive-complete');
const recvSummary = $('recv-summary');
const recvCrc = $('recv-crc');
const btnDownload = $<HTMLButtonElement>('btn-download');
const textResult = $('text-result');
const textContent = $<HTMLPreElement>('text-content');
const btnCopy = $<HTMLButtonElement>('btn-copy');
const copyLabel = $('copy-label');

// Feedback QR (receiver)
const btnShowFeedback = $<HTMLButtonElement>('btn-show-feedback');
const feedbackQROverlay = $('feedback-qr-overlay');
const feedbackQRCanvas = $<HTMLCanvasElement>('feedback-qr-canvas');
const feedbackQRInfo = $('feedback-qr-info');
const btnDismissFeedback = $<HTMLButtonElement>('btn-dismiss-feedback');

// ===== State =====
let sender: Sender | null = null;
let receiver: Receiver | null = null;
let currentFile: File | null = null;
let currentText: string | null = null;
let sendMode: 'file' | 'text' = 'file';
let downloadBlob: Blob | null = null;
let downloadFilename = '';
let receivedText: string | null = null;
let receivedFileData: Uint8Array | null = null;
let receivedFilename = '';

// ===== Tab Switching =====
function switchTab(tab: 'send' | 'receive') {
  tabSend.classList.toggle('active', tab === 'send');
  tabReceive.classList.toggle('active', tab === 'receive');
  sendPanel.classList.toggle('active', tab === 'send');
  receivePanel.classList.toggle('active', tab === 'receive');
}

tabSend.addEventListener('click', () => switchTab('send'));
tabReceive.addEventListener('click', () => switchTab('receive'));

// ===== Send: Mode Toggle =====
function switchSendMode(mode: 'file' | 'text') {
  sendMode = mode;
  modeFile.classList.toggle('active', mode === 'file');
  modeText.classList.toggle('active', mode === 'text');
  if (sender) { sender.destroy(); sender = null; }
  sendActive.classList.add('hidden');
  if (mode === 'file') {
    dropZone.classList.remove('hidden');
    textInputZone.classList.add('hidden');
  } else {
    dropZone.classList.add('hidden');
    textInputZone.classList.remove('hidden');
    textInput.focus();
  }
}

modeFile.addEventListener('click', () => switchSendMode('file'));
modeText.addEventListener('click', () => switchSendMode('text'));

// ===== Send: Text Input =====
textInput.addEventListener('input', () => {
  textCharCount.textContent = `${textInput.value.length} characters`;
});

btnGenerateQR.addEventListener('click', () => handleText(textInput.value));

async function handleText(text: string) {
  if (!text.trim()) return;
  currentText = text;
  currentFile = null;
  if (sender) sender.destroy();
  sender = new Sender(qrCanvas, createSenderCallbacks());
  const chunkSize = parseInt(chunkSizeSlider.value);
  await sender.loadText(text, chunkSize);
  textInputZone.classList.add('hidden');
  sendActive.classList.remove('hidden');
  if (sender.totalPackets > 1) {
    qrOverlay.classList.add('hidden');
    sender.play();
    updatePlayButton();
  }
}

// ===== Send: File Selection =====
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
});
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('drag-over'); });
dropZone.addEventListener('drop', (e) => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  if (e.dataTransfer?.files[0]) handleFile(e.dataTransfer.files[0]);
});

function createSenderCallbacks() {
  return {
    onReady: (total: number) => {
      dropZone.classList.add('hidden');
      sendActive.classList.remove('hidden');
      sendTotal.textContent = String(total);
      sendCurrent.textContent = '1';
      sendProgress.style.width = `${(1 / total) * 100}%`;
      qrOverlay.classList.remove('hidden');
      updatePlayButton();
      initSendChunkGrid(total);
    },
    onProgress: (current: number, total: number) => {
      sendCurrent.textContent = String(current + 1);
      sendTotal.textContent = String(total);
      sendProgress.style.width = `${((current + 1) / total) * 100}%`;
      highlightSendingChunk(current, total);
    },
    onFeedbackReceived: (receivedCount: number, total: number, receivedSet: Set<number>) => {
      chunkCount.textContent = `${total - receivedCount} remaining`;
      feedbackResult.classList.remove('hidden');
      feedbackResult.textContent = `Feedback: ${receivedCount}/${total} confirmed, ${total - receivedCount} remaining`;
      updateSendChunkGrid(total, receivedSet);
    },
    onTransferComplete: () => {
      chunkCount.textContent = 'Transfer complete!';
      feedbackResult.textContent = 'All chunks confirmed!';
      const cells = sendChunkGrid.children;
      for (let i = 0; i < cells.length; i++) {
        (cells[i] as HTMLElement).classList.add('received');
      }
    },
  };
}

async function handleFile(file: File) {
  currentFile = file;
  currentText = null;
  if (sender) sender.destroy();
  sender = new Sender(qrCanvas, createSenderCallbacks());
  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  const chunkSize = parseInt(chunkSizeSlider.value);
  await sender.loadFile(file, chunkSize);
  chunkCount.textContent = `${sender.totalPackets} chunks`;
}

// ===== Send: Controls =====
btnPlay.addEventListener('click', async () => {
  if (!sender) return;
  if (sender.isPlaying) {
    sender.pause();
  } else {
    qrOverlay.classList.add('hidden');
    sender.play();
  }
  updatePlayButton();
});

btnPrev.addEventListener('click', () => { if (sender) { qrOverlay.classList.add('hidden'); sender.prev(); } });
btnNext.addEventListener('click', () => { if (sender) { qrOverlay.classList.add('hidden'); sender.next(); } });

function updatePlayButton() {
  if (!sender) return;
  const playing = sender.isPlaying;
  iconPlay.classList.toggle('hidden', playing);
  iconPause.classList.toggle('hidden', !playing);
  playLabel.textContent = playing ? 'Pause' : 'Play';
}

chunkSizeSlider.addEventListener('input', () => { chunkSizeVal.textContent = `${chunkSizeSlider.value} B`; });
chunkSizeSlider.addEventListener('change', async () => {
  if (!sender) return;
  if (!currentFile && !currentText) return;
  sender.destroy();
  sender = new Sender(qrCanvas, createSenderCallbacks());
  const cs = parseInt(chunkSizeSlider.value);
  if (currentFile) await sender.loadFile(currentFile, cs);
  else if (currentText) await sender.loadText(currentText, cs);
});
speedSlider.addEventListener('input', () => {
  speedVal.textContent = `${speedSlider.value} ms`;
  if (sender) sender.setSpeed(parseInt(speedSlider.value));
});

// ===== Send: Scan Feedback QR =====
let feedbackStream: MediaStream | null = null;
let scanningFeedback = false;
let feedbackFacing: 'environment' | 'user' = 'environment';

btnScanFeedback.addEventListener('click', async () => {
  if (!sender) return;
  const wasPlaying = sender.isPlaying;
  if (wasPlaying) sender.pause();

  scanningFeedback = true;
  feedbackScanner.classList.remove('hidden');

  try {
    feedbackStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: feedbackFacing },
    });
    feedbackCamera.srcObject = feedbackStream;
    await feedbackCamera.play();
  } catch {
    stopFeedbackScan();
    if (wasPlaying) sender.play();
    updatePlayButton();
    return;
  }

  const ctx = feedbackScanCanvas.getContext('2d', { willReadFrequently: true })!;
  const scanLoop = () => {
    if (!scanningFeedback) return;
    if (feedbackCamera.readyState === feedbackCamera.HAVE_ENOUGH_DATA) {
      feedbackScanCanvas.width = feedbackCamera.videoWidth;
      feedbackScanCanvas.height = feedbackCamera.videoHeight;
      ctx.drawImage(feedbackCamera, 0, 0);
      const imageData = ctx.getImageData(0, 0, feedbackScanCanvas.width, feedbackScanCanvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) {
        const packet = parseFeedback(code.data);
        if (packet) {
          stopFeedbackScan();
          sender!.applyFeedback(packet);
          if (wasPlaying) sender!.play();
          updatePlayButton();
          return;
        }
      }
    }
    requestAnimationFrame(scanLoop);
  };
  requestAnimationFrame(scanLoop);
});

function stopFeedbackScan() {
  scanningFeedback = false;
  if (feedbackStream) {
    feedbackStream.getTracks().forEach(t => t.stop());
    feedbackStream = null;
  }
  feedbackScanner.classList.add('hidden');
}

btnCancelScan.addEventListener('click', () => {
  stopFeedbackScan();
  if (sender && !sender.isPlaying) { sender.play(); updatePlayButton(); }
});

btnFlipFeedbackCam.addEventListener('click', async () => {
  feedbackFacing = feedbackFacing === 'environment' ? 'user' : 'environment';
  if (feedbackStream) {
    feedbackStream.getTracks().forEach(t => t.stop());
    feedbackStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: feedbackFacing },
    });
    feedbackCamera.srcObject = feedbackStream;
    await feedbackCamera.play();
  }
});

// ===== Send: Chunk Grid =====
function initSendChunkGrid(total: number) {
  sendChunkGrid.classList.remove('hidden');
  sendChunkGrid.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const cell = document.createElement('div');
    cell.className = 'chunk-cell';
    cell.title = `Chunk ${i}`;
    sendChunkGrid.appendChild(cell);
  }
}

function highlightSendingChunk(current: number, total: number) {
  if (sendChunkGrid.children.length !== total) return;
  const prev = sendChunkGrid.querySelector('.sending');
  if (prev) prev.classList.remove('sending');
  const cell = sendChunkGrid.children[current] as HTMLElement;
  if (cell && !cell.classList.contains('received')) cell.classList.add('sending');
}

function updateSendChunkGrid(total: number, received: Set<number>) {
  sendChunkGrid.classList.remove('hidden');
  if (sendChunkGrid.children.length !== total) {
    sendChunkGrid.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const cell = document.createElement('div');
      cell.className = 'chunk-cell';
      sendChunkGrid.appendChild(cell);
    }
  }
  const cells = sendChunkGrid.children;
  for (let i = 0; i < total; i++) {
    const cell = cells[i] as HTMLElement;
    if (received.has(i) && !cell.classList.contains('received')) {
      cell.classList.add('received', 'just-received');
      setTimeout(() => cell.classList.remove('just-received'), 400);
    }
  }
}

// ===== Receive: Camera =====
let scanFlashTimeout: number | null = null;

btnStartScan.addEventListener('click', async () => {
  receiveIdle.classList.add('hidden');
  receiveActive.classList.remove('hidden');
  receiveComplete.classList.add('hidden');
  recvInfo.classList.add('hidden');
  btnShowFeedback.classList.add('hidden');

  receiver = new Receiver(cameraVideo, scanCanvas, {
    onChunkReceived: (index, total, received) => {
      recvInfo.classList.remove('hidden');
      btnShowFeedback.classList.remove('hidden');
      recvCurrent.textContent = String(received);
      recvTotal.textContent = String(total);
      recvProgress.style.width = `${(received / total) * 100}%`;
      updateChunkGrid(total, receiver!.receivedChunks);
      scanIndicator.classList.remove('hidden');
      if (scanFlashTimeout) clearTimeout(scanFlashTimeout);
      scanFlashTimeout = window.setTimeout(() => { scanIndicator.classList.add('hidden'); }, 500);
    },
    onComplete: (data, metadata) => { showComplete(data, metadata); },
    onError: (error) => { showError(error); },
  });

  try {
    await receiver.start();
  } catch (err) {
    showError(`Camera access denied: ${err}`);
    receiveIdle.classList.remove('hidden');
    receiveActive.classList.add('hidden');
  }
});

btnStopScan.addEventListener('click', () => {
  if (receiver) receiver.stop();
  receiveIdle.classList.remove('hidden');
  receiveActive.classList.add('hidden');
});

btnResetScan.addEventListener('click', () => {
  if (receiver) receiver.reset();
  recvInfo.classList.add('hidden');
  receiveComplete.classList.add('hidden');
  chunkGrid.innerHTML = '';
  recvCurrent.textContent = '0';
  recvTotal.textContent = '0';
  recvProgress.style.width = '0%';
  btnStartScan.click();
});

// ===== Receive: Show Feedback QR =====
btnShowFeedback.addEventListener('click', async () => {
  if (!receiver || receiver.receivedCount === 0) return;
  await receiver.renderFeedbackQR(feedbackQRCanvas);
  feedbackQRInfo.textContent = `${receiver.receivedCount}/${receiver.total} chunks received`;
  feedbackQROverlay.classList.remove('hidden');
});

btnDismissFeedback.addEventListener('click', () => {
  feedbackQROverlay.classList.add('hidden');
});

// ===== Receive: Chunk Grid =====
function updateChunkGrid(total: number, received: Set<number>) {
  if (chunkGrid.children.length !== total) {
    chunkGrid.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const cell = document.createElement('div');
      cell.className = 'chunk-cell';
      cell.title = `Chunk ${i}`;
      chunkGrid.appendChild(cell);
    }
  }
  const cells = chunkGrid.children;
  for (let i = 0; i < total; i++) {
    const cell = cells[i] as HTMLElement;
    if (received.has(i) && !cell.classList.contains('received')) {
      cell.classList.add('received', 'just-received');
      setTimeout(() => cell.classList.remove('just-received'), 400);
    }
  }
}

// ===== Receive: Complete =====
function showComplete(data: Uint8Array, metadata: TransferMetadata) {
  receiveComplete.classList.remove('hidden');
  recvInfo.classList.remove('hidden');
  recvCrc.textContent = `CRC32: ${metadata.hash}`;
  const cameraWrapper = receiveActive.querySelector('.camera-wrapper') as HTMLElement;
  if (cameraWrapper) cameraWrapper.classList.add('hidden');
  const recvControls = receiveActive.querySelector('.receive-controls') as HTMLElement;
  if (recvControls) recvControls.classList.add('hidden');
  btnShowFeedback.classList.add('hidden');

  if (metadata.type === 'text') {
    const text = new TextDecoder().decode(data);
    receivedText = text;
    recvFilename.textContent = 'Text snippet';
    recvFilesize.textContent = formatFileSize(metadata.fileSize);
    recvSummary.textContent = `Text (${formatFileSize(metadata.fileSize)})`;
    textResult.classList.remove('hidden');
    textContent.textContent = text;
    btnDownload.classList.add('hidden');
  } else {
    receivedText = null;
    receivedFileData = data;
    receivedFilename = metadata.filename;
    recvFilename.textContent = metadata.filename;
    recvFilesize.textContent = formatFileSize(metadata.fileSize);
    recvSummary.textContent = `${metadata.filename} (${formatFileSize(metadata.fileSize)})`;
    textResult.classList.add('hidden');
    btnDownload.classList.remove('hidden');
    downloadBlob = new Blob([data as unknown as BlobPart]);
    downloadFilename = metadata.filename;

    // Show image preview for image files
    const ext = metadata.filename.toLowerCase().split('.').pop() || '';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
      showImagePreview(downloadBlob, metadata.filename);
    }
  }
}

// ===== Receive: Copy & Re-send =====
btnCopy.addEventListener('click', async () => {
  if (!receivedText) return;
  try {
    await navigator.clipboard.writeText(receivedText);
    copyLabel.textContent = 'Copied!';
    setTimeout(() => { copyLabel.textContent = 'Copy to Clipboard'; }, 2000);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = receivedText;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    copyLabel.textContent = 'Copied!';
    setTimeout(() => { copyLabel.textContent = 'Copy to Clipboard'; }, 2000);
  }
});

const btnResend = $<HTMLButtonElement>('btn-resend');
btnResend.addEventListener('click', async () => {
  if (receivedText) {
    switchTab('send'); switchSendMode('text');
    textInput.value = receivedText;
    textCharCount.textContent = `${receivedText.length} characters`;
    handleText(receivedText);
  } else if (receivedFileData) {
    const file = new File([receivedFileData as unknown as BlobPart], receivedFilename);
    switchTab('send'); switchSendMode('file');
    await handleFile(file);
  }
});

const btnReceiveNew = $<HTMLButtonElement>('btn-receive-new');
btnReceiveNew.addEventListener('click', () => {
  if (receiver) receiver.reset();
  recvInfo.classList.add('hidden');
  receiveComplete.classList.add('hidden');
  textResult.classList.add('hidden');
  chunkGrid.innerHTML = '';
  recvCurrent.textContent = '0'; recvTotal.textContent = '0'; recvProgress.style.width = '0%';
  recvFilename.textContent = '-'; recvFilesize.textContent = '-';
  const cameraWrapper = receiveActive.querySelector('.camera-wrapper') as HTMLElement;
  if (cameraWrapper) cameraWrapper.classList.remove('hidden');
  const recvControls = receiveActive.querySelector('.receive-controls') as HTMLElement;
  if (recvControls) recvControls.classList.remove('hidden');
  btnStartScan.click();
});

btnDownload.addEventListener('click', () => {
  if (!downloadBlob) return;
  const url = URL.createObjectURL(downloadBlob);
  const a = document.createElement('a');
  a.href = url; a.download = downloadFilename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ===== Image Preview =====
function showImagePreview(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const overlay = document.createElement('div');
  overlay.className = 'image-preview-overlay';
  overlay.innerHTML = `
    <div class="image-preview-content">
      <button class="image-preview-close">&times;</button>
      <img src="${url}" alt="${filename}" />
      <div class="image-preview-footer">
        <span>${filename}</span>
        <a href="${url}" download="${filename}" class="btn btn-primary">Download</a>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('.image-preview-close')!.addEventListener('click', () => {
    overlay.remove();
    URL.revokeObjectURL(url);
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { overlay.remove(); URL.revokeObjectURL(url); }
  });
}

// ===== Camera Flip =====
const btnFlipCam = $<HTMLButtonElement>('btn-flip-cam');
btnFlipCam.addEventListener('click', () => { if (receiver) receiver.flipCamera(); });

// ===== Error Toast =====
function showError(message: string) {
  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 5000);
}
