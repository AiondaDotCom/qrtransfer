import './styles.css';
import { Sender } from './sender';
import { Receiver } from './receiver';
import { SmartSender } from './smart-sender';
import { SmartReceiver } from './smart-receiver';
import { formatFileSize, TransferMetadata } from './protocol';

// ===== DOM Elements =====
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const tabSend = $<HTMLButtonElement>('tab-send');
const tabReceive = $<HTMLButtonElement>('tab-receive');
const tabSmart = $<HTMLButtonElement>('tab-smart');
const sendPanel = $('send-panel');
const receivePanel = $('receive-panel');
const smartPanel = $('smart-panel');

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
function switchTab(tab: 'send' | 'receive' | 'smart') {
  tabSend.classList.toggle('active', tab === 'send');
  tabReceive.classList.toggle('active', tab === 'receive');
  tabSmart.classList.toggle('active', tab === 'smart');
  sendPanel.classList.toggle('active', tab === 'send');
  receivePanel.classList.toggle('active', tab === 'receive');
  smartPanel.classList.toggle('active', tab === 'smart');
}

tabSend.addEventListener('click', () => switchTab('send'));
tabReceive.addEventListener('click', () => switchTab('receive'));
tabSmart.addEventListener('click', () => switchTab('smart'));

// ===== Send: Mode Toggle =====
function switchSendMode(mode: 'file' | 'text') {
  sendMode = mode;
  modeFile.classList.toggle('active', mode === 'file');
  modeText.classList.toggle('active', mode === 'text');

  // Reset active send display when switching modes
  if (sender) {
    sender.destroy();
    sender = null;
  }
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

  sender = new Sender(qrCanvas, {
    onReady: (total) => {
      textInputZone.classList.add('hidden');
      sendActive.classList.remove('hidden');
      fileName.textContent = 'Text snippet';
      fileSize.textContent = formatFileSize(new TextEncoder().encode(text).length);
      chunkCount.textContent = `${total} chunk${total > 1 ? 's' : ''}`;
      sendTotal.textContent = String(total);
      sendCurrent.textContent = '1';
      sendProgress.style.width = `${(1 / total) * 100}%`;
      if (total === 1) {
        qrOverlay.classList.add('hidden');
      } else {
        qrOverlay.classList.remove('hidden');
      }
      updatePlayButton();
    },
    onProgress: (current, total) => {
      sendCurrent.textContent = String(current + 1);
      sendTotal.textContent = String(total);
      sendProgress.style.width = `${((current + 1) / total) * 100}%`;
    },
  });

  const chunkSize = parseInt(chunkSizeSlider.value);
  await sender.loadText(text, chunkSize);

  // Auto-play if multiple chunks
  if (sender.totalPackets > 1) {
    qrOverlay.classList.add('hidden');
    sender.play();
    updatePlayButton();
  }
}

// ===== Send: File Selection =====
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files[0]) {
    handleFile(fileInput.files[0]);
  }
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer?.files[0]) {
    handleFile(e.dataTransfer.files[0]);
  }
});

async function handleFile(file: File) {
  currentFile = file;

  if (sender) {
    sender.destroy();
  }

  sender = new Sender(qrCanvas, {
    onReady: (total) => {
      dropZone.classList.add('hidden');
      sendActive.classList.remove('hidden');
      fileName.textContent = file.name;
      fileSize.textContent = formatFileSize(file.size);
      chunkCount.textContent = `${total} chunks`;
      sendTotal.textContent = String(total);
      sendCurrent.textContent = '1';
      sendProgress.style.width = `${(1 / total) * 100}%`;
      qrOverlay.classList.remove('hidden');
      updatePlayButton();
    },
    onProgress: (current, total) => {
      sendCurrent.textContent = String(current + 1);
      sendTotal.textContent = String(total);
      sendProgress.style.width = `${((current + 1) / total) * 100}%`;
    },
  });

  const chunkSize = parseInt(chunkSizeSlider.value);
  await sender.loadFile(file, chunkSize);
}

// ===== Send: Controls =====
btnPlay.addEventListener('click', () => {
  if (!sender) return;
  if (sender.isPlaying) {
    sender.pause();
  } else {
    qrOverlay.classList.add('hidden');
    sender.play();
  }
  updatePlayButton();
});

btnPrev.addEventListener('click', () => {
  if (!sender) return;
  qrOverlay.classList.add('hidden');
  sender.prev();
});

btnNext.addEventListener('click', () => {
  if (!sender) return;
  qrOverlay.classList.add('hidden');
  sender.next();
});

function updatePlayButton() {
  if (!sender) return;
  const playing = sender.isPlaying;
  iconPlay.classList.toggle('hidden', playing);
  iconPause.classList.toggle('hidden', !playing);
  playLabel.textContent = playing ? 'Pause' : 'Play';
}

// ===== Send: Settings =====
chunkSizeSlider.addEventListener('input', () => {
  chunkSizeVal.textContent = `${chunkSizeSlider.value} B`;
});

chunkSizeSlider.addEventListener('change', async () => {
  if (!sender) return;
  if (!currentFile && !currentText) return;
  sender.destroy();
  sender = new Sender(qrCanvas, {
    onReady: (total) => {
      chunkCount.textContent = `${total} chunk${total > 1 ? 's' : ''}`;
      sendTotal.textContent = String(total);
      sendCurrent.textContent = '1';
      sendProgress.style.width = `${(1 / total) * 100}%`;
      qrOverlay.classList.remove('hidden');
      updatePlayButton();
    },
    onProgress: (current, total) => {
      sendCurrent.textContent = String(current + 1);
      sendTotal.textContent = String(total);
      sendProgress.style.width = `${((current + 1) / total) * 100}%`;
    },
  });
  const cs = parseInt(chunkSizeSlider.value);
  if (currentFile) {
    await sender.loadFile(currentFile, cs);
  } else if (currentText) {
    await sender.loadText(currentText, cs);
  }
});

speedSlider.addEventListener('input', () => {
  speedVal.textContent = `${speedSlider.value} ms`;
  if (sender) {
    sender.setSpeed(parseInt(speedSlider.value));
  }
});

// ===== Receive: Camera =====
let scanFlashTimeout: number | null = null;

btnStartScan.addEventListener('click', async () => {
  receiveIdle.classList.add('hidden');
  receiveActive.classList.remove('hidden');
  receiveComplete.classList.add('hidden');
  recvInfo.classList.add('hidden');

  receiver = new Receiver(cameraVideo, scanCanvas, {
    onChunkReceived: (index, total, received) => {
      recvInfo.classList.remove('hidden');

      // Update filename from chunk 0
      if (index === 0) {
        // We need to get metadata from the receiver... let's read it from the DOM update
      }

      recvCurrent.textContent = String(received);
      recvTotal.textContent = String(total);
      recvProgress.style.width = `${(received / total) * 100}%`;

      // Update chunk grid
      updateChunkGrid(total, receiver!.receivedChunks);

      // Flash indicator
      scanIndicator.classList.remove('hidden');
      if (scanFlashTimeout) clearTimeout(scanFlashTimeout);
      scanFlashTimeout = window.setTimeout(() => {
        scanIndicator.classList.add('hidden');
      }, 500);
    },
    onComplete: (data, metadata) => {
      showComplete(data, metadata);
    },
    onError: (error) => {
      showError(error);
    },
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
  if (receiver) {
    receiver.stop();
  }
  receiveIdle.classList.remove('hidden');
  receiveActive.classList.add('hidden');
});

btnResetScan.addEventListener('click', () => {
  if (receiver) {
    receiver.reset();
  }
  recvInfo.classList.add('hidden');
  receiveComplete.classList.add('hidden');
  chunkGrid.innerHTML = '';
  recvCurrent.textContent = '0';
  recvTotal.textContent = '0';
  recvProgress.style.width = '0%';

  // Restart
  btnStartScan.click();
});

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

  // Update filename/size from first chunk
  if (received.has(0)) {
    // Parse info from receiver state — we read the filename from the first packet
    const firstCell = chunkGrid.querySelector('.chunk-cell');
    if (firstCell && recvFilename.textContent === '-') {
      // The metadata is in the assembled chunks; we need another way
      // Let's try to get it from the chunk data
    }
  }
}

function showComplete(data: Uint8Array, metadata: TransferMetadata) {
  receiveComplete.classList.remove('hidden');
  recvInfo.classList.remove('hidden');
  recvCrc.textContent = `CRC32: ${metadata.hash}`;

  // Hide camera
  const cameraWrapper = receiveActive.querySelector('.camera-wrapper') as HTMLElement;
  if (cameraWrapper) cameraWrapper.classList.add('hidden');
  const recvControls = receiveActive.querySelector('.receive-controls') as HTMLElement;
  if (recvControls) recvControls.classList.add('hidden');

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
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = receivedText;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    copyLabel.textContent = 'Copied!';
    setTimeout(() => { copyLabel.textContent = 'Copy to Clipboard'; }, 2000);
  }
});

const btnResend = $<HTMLButtonElement>('btn-resend');
btnResend.addEventListener('click', async () => {
  if (receivedText) {
    switchTab('send');
    switchSendMode('text');
    textInput.value = receivedText;
    textCharCount.textContent = `${receivedText.length} characters`;
    handleText(receivedText);
  } else if (receivedFileData) {
    // Create a File object from received data and send it
    const file = new File([receivedFileData as unknown as BlobPart], receivedFilename);
    switchTab('send');
    switchSendMode('file');
    await handleFile(file);
  }
});

// ===== Receive: New Transfer =====
const btnReceiveNew = $<HTMLButtonElement>('btn-receive-new');
btnReceiveNew.addEventListener('click', () => {
  if (receiver) receiver.reset();
  // Reset UI
  recvInfo.classList.add('hidden');
  receiveComplete.classList.add('hidden');
  textResult.classList.add('hidden');
  chunkGrid.innerHTML = '';
  recvCurrent.textContent = '0';
  recvTotal.textContent = '0';
  recvProgress.style.width = '0%';
  recvFilename.textContent = '-';
  recvFilesize.textContent = '-';
  // Show camera and controls again
  const cameraWrapper = receiveActive.querySelector('.camera-wrapper') as HTMLElement;
  if (cameraWrapper) cameraWrapper.classList.remove('hidden');
  const recvControls = receiveActive.querySelector('.receive-controls') as HTMLElement;
  if (recvControls) recvControls.classList.remove('hidden');
  // Restart scanning
  btnStartScan.click();
});

btnDownload.addEventListener('click', () => {
  if (!downloadBlob) return;
  const url = URL.createObjectURL(downloadBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

function showError(message: string) {
  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 5000);
}

// ===== Camera Flip (Receive) =====
const btnFlipCam = $<HTMLButtonElement>('btn-flip-cam');
btnFlipCam.addEventListener('click', () => {
  if (receiver) receiver.flipCamera();
});

// ===== Smart Transfer =====
const smartModeSend = $<HTMLButtonElement>('smart-mode-send');
const smartModeRecv = $<HTMLButtonElement>('smart-mode-recv');
const smartSendView = $('smart-send-view');
const smartRecvView = $('smart-recv-view');

// Smart Send elements
const smartDropZone = $('smart-drop-zone');
const smartFileInput = $<HTMLInputElement>('smart-file-input');
const smartSendIdle = $('smart-send-idle');
const smartSendActive = $('smart-send-active');
const smartSendFilename = $('smart-send-filename');
const smartSendFilesize = $('smart-send-filesize');
const smartSendQr = $<HTMLCanvasElement>('smart-send-qr');
const smartSendCamera = $<HTMLVideoElement>('smart-send-camera');
const smartSendScan = $<HTMLCanvasElement>('smart-send-scan');
const smartFeedbackStatus = $('smart-feedback-status');
const smartSendRemaining = $('smart-send-remaining');
const smartSendTotal = $('smart-send-total');
const smartSendProgress = $('smart-send-progress');
const smartBtnPlay = $<HTMLButtonElement>('smart-btn-play');
const smartIconPlay = $('smart-icon-play');
const smartIconPause = $('smart-icon-pause');
const smartPlayLabel = $('smart-play-label');
const smartBtnStop = $<HTMLButtonElement>('smart-btn-stop');
const smartSendComplete = $('smart-send-complete');

// Smart Receive elements
const smartRecvIdle = $('smart-recv-idle');
const smartRecvActive = $('smart-recv-active');
const smartBtnStartRecv = $<HTMLButtonElement>('smart-btn-start-recv');
const smartRecvCamera = $<HTMLVideoElement>('smart-recv-camera');
const smartRecvScan = $<HTMLCanvasElement>('smart-recv-scan');
const smartFeedbackQr = $<HTMLCanvasElement>('smart-feedback-qr');
const smartRecvCurrent = $('smart-recv-current');
const smartRecvTotal = $('smart-recv-total');
const smartRecvProgress = $('smart-recv-progress');
const smartChunkGrid = $('smart-chunk-grid');
const smartRecvComplete = $('smart-recv-complete');
const smartRecvSummary = $('smart-recv-summary');
const smartRecvCrc = $('smart-recv-crc');
const smartBtnDownload = $<HTMLButtonElement>('smart-btn-download');
const smartBtnStopRecv = $<HTMLButtonElement>('smart-btn-stop-recv');

let smartSender: SmartSender | null = null;
let smartReceiver: SmartReceiver | null = null;

// Smart mode toggle
smartModeSend.addEventListener('click', () => {
  smartModeSend.classList.add('active');
  smartModeRecv.classList.remove('active');
  smartSendView.classList.remove('hidden');
  smartRecvView.classList.add('hidden');
});

smartModeRecv.addEventListener('click', () => {
  smartModeRecv.classList.add('active');
  smartModeSend.classList.remove('active');
  smartRecvView.classList.remove('hidden');
  smartSendView.classList.add('hidden');
});

// Smart Send: file selection
smartDropZone.addEventListener('click', () => smartFileInput.click());
smartFileInput.addEventListener('change', () => {
  if (smartFileInput.files && smartFileInput.files[0]) {
    handleSmartFile(smartFileInput.files[0]);
  }
});
smartDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  smartDropZone.classList.add('drag-over');
});
smartDropZone.addEventListener('dragleave', () => {
  smartDropZone.classList.remove('drag-over');
});
smartDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  smartDropZone.classList.remove('drag-over');
  if (e.dataTransfer?.files[0]) handleSmartFile(e.dataTransfer.files[0]);
});

async function handleSmartFile(file: File) {
  if (smartSender) smartSender.destroy();

  smartSender = new SmartSender(smartSendQr, smartSendCamera, smartSendScan, {
    onReady: (total) => {
      smartSendIdle.classList.add('hidden');
      smartSendActive.classList.remove('hidden');
      smartSendComplete.classList.add('hidden');
      smartSendFilename.textContent = file.name;
      smartSendFilesize.textContent = formatFileSize(file.size);
      smartSendTotal.textContent = String(total);
      smartSendRemaining.textContent = String(total);
      smartSendProgress.style.width = '0%';
    },
    onProgress: (_current, total, remaining) => {
      smartSendRemaining.textContent = String(remaining);
      smartSendTotal.textContent = String(total);
      const pct = ((total - remaining) / total) * 100;
      smartSendProgress.style.width = `${pct}%`;
    },
    onFeedbackReceived: (received, total) => {
      smartFeedbackStatus.textContent = `Feedback: ${received}/${total} received`;
      smartFeedbackStatus.classList.add('active');
    },
    onComplete: () => {
      smartSendComplete.classList.remove('hidden');
      updateSmartPlayButton();
    },
  });

  await smartSender.loadFile(file, 300);
}

// Smart Send: controls
smartBtnPlay.addEventListener('click', async () => {
  if (!smartSender) return;
  if (smartSender.isPlaying) {
    smartSender.pause();
  } else {
    try {
      await smartSender.startCamera();
    } catch { /* camera optional */ }
    smartSender.play();
  }
  updateSmartPlayButton();
});

smartBtnStop.addEventListener('click', () => {
  if (smartSender) smartSender.destroy();
  smartSendIdle.classList.remove('hidden');
  smartSendActive.classList.add('hidden');
  smartFeedbackStatus.textContent = 'Waiting for feedback...';
  smartFeedbackStatus.classList.remove('active');
});

function updateSmartPlayButton() {
  if (!smartSender) return;
  const playing = smartSender.isPlaying;
  smartIconPlay.classList.toggle('hidden', playing);
  smartIconPause.classList.toggle('hidden', !playing);
  smartPlayLabel.textContent = playing ? 'Pause' : 'Start';
}

// Smart Receive
smartBtnStartRecv.addEventListener('click', async () => {
  smartRecvIdle.classList.add('hidden');
  smartRecvActive.classList.remove('hidden');
  smartRecvComplete.classList.add('hidden');

  if (smartReceiver) smartReceiver.reset();

  smartReceiver = new SmartReceiver(
    smartRecvCamera,
    smartRecvScan,
    smartFeedbackQr,
    {
      onChunkReceived: (_index, total, received) => {
        smartRecvCurrent.textContent = String(received);
        smartRecvTotal.textContent = String(total);
        smartRecvProgress.style.width = `${(received / total) * 100}%`;
        updateSmartChunkGrid(total, smartReceiver!.receivedChunks);
      },
      onComplete: (data, metadata) => {
        smartRecvComplete.classList.remove('hidden');
        smartRecvSummary.textContent = `${metadata.filename} (${formatFileSize(metadata.fileSize)})`;
        smartRecvCrc.textContent = `CRC32: ${metadata.hash}`;

        const blob = new Blob([data as unknown as BlobPart]);
        const fname = metadata.filename;
        smartBtnDownload.onclick = () => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fname;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        };
      },
      onError: (error) => showError(error),
      onFeedbackUpdated: () => {},
    }
  );

  try {
    await smartReceiver.start();
  } catch (err) {
    showError(`Camera access denied: ${err}`);
    smartRecvIdle.classList.remove('hidden');
    smartRecvActive.classList.add('hidden');
  }
});

smartBtnStopRecv.addEventListener('click', () => {
  if (smartReceiver) smartReceiver.stop();
  smartRecvIdle.classList.remove('hidden');
  smartRecvActive.classList.add('hidden');
});

// Smart camera flip buttons
const btnFlipSmartSend = $<HTMLButtonElement>('btn-flip-smart-send');
btnFlipSmartSend.addEventListener('click', () => {
  if (smartSender) smartSender.flipCamera();
});

const btnFlipSmartRecv = $<HTMLButtonElement>('btn-flip-smart-recv');
btnFlipSmartRecv.addEventListener('click', () => {
  if (smartReceiver) smartReceiver.flipCamera();
});

function updateSmartChunkGrid(total: number, received: Set<number>) {
  if (smartChunkGrid.children.length !== total) {
    smartChunkGrid.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const cell = document.createElement('div');
      cell.className = 'chunk-cell';
      smartChunkGrid.appendChild(cell);
    }
  }
  const cells = smartChunkGrid.children;
  for (let i = 0; i < total; i++) {
    const cell = cells[i] as HTMLElement;
    if (received.has(i) && !cell.classList.contains('received')) {
      cell.classList.add('received', 'just-received');
      setTimeout(() => cell.classList.remove('just-received'), 400);
    }
  }
}
