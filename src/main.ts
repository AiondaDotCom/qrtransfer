import './styles.css';
import { Sender } from './sender';
import { Receiver } from './receiver';
import { formatFileSize, parseFragments, TransferMetadata } from './protocol';
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
const fragmentList = $('fragment-list');
const btnAddFragment = $<HTMLButtonElement>('btn-add-fragment');
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
const sendProgressText = $('send-progress-text');
const chunkGridHint = $('chunk-grid-hint');
const sendCurrent = $('send-current');
const sendTotal = $('send-total');
const btnPlayOverlay = $<HTMLButtonElement>('btn-play-overlay');
const btnResumeAll = $<HTMLButtonElement>('btn-resume-all');

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
const fragmentResults = $('fragment-results');

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
let currentFragments: string[] | null = null;
let sendMode: 'file' | 'text' = 'file';
let downloadBlob: Blob | null = null;
let downloadFilename = '';
let receivedFragments: string[] | null = null;
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
    if (fragmentList.children.length === 0) addFragmentInput();
    focusFragment(0);
  }
}

modeFile.addEventListener('click', () => switchSendMode('file'));
modeText.addEventListener('click', () => switchSendMode('text'));

// ===== Send: Text Fragments =====
// Each fragment (e.g. user / password / url) gets its own copy button on the receiver.
const COPY_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const REMOVE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

function getFragmentInputs(): HTMLTextAreaElement[] {
  return Array.from(fragmentList.querySelectorAll('textarea'));
}

function focusFragment(index: number) {
  getFragmentInputs()[index]?.focus();
}

function autoGrow(ta: HTMLTextAreaElement) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

function updateFragmentUI() {
  const inputs = getFragmentInputs();
  inputs.forEach((ta, i) => {
    ta.placeholder = inputs.length === 1
      ? 'Paste text, links, or notes here...'
      : `Fragment ${i + 1}`;
  });
  fragmentList.classList.toggle('single', inputs.length === 1);
  const chars = inputs.reduce((sum, ta) => sum + ta.value.length, 0);
  const filled = inputs.filter(ta => ta.value.length > 0).length;
  textCharCount.textContent = inputs.length > 1
    ? `${filled} fragments, ${chars} characters`
    : `${chars} characters`;
}

function addFragmentInput(value = '') {
  const row = document.createElement('div');
  row.className = 'fragment-row';
  const ta = document.createElement('textarea');
  ta.rows = 1;
  ta.value = value;
  ta.spellcheck = false;
  ta.autocapitalize = 'off';
  ta.addEventListener('input', () => { autoGrow(ta); updateFragmentUI(); });
  ta.addEventListener('keydown', (e) => {
    // Cmd/Ctrl+Enter: new fragment below
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      addFragmentInput();
      focusFragment(getFragmentInputs().length - 1);
    }
  });
  const btnRemove = document.createElement('button');
  btnRemove.className = 'btn-fragment-remove';
  btnRemove.title = 'Remove fragment';
  btnRemove.innerHTML = REMOVE_ICON;
  btnRemove.addEventListener('click', () => {
    row.remove();
    if (fragmentList.children.length === 0) addFragmentInput();
    updateFragmentUI();
  });
  row.append(ta, btnRemove);
  fragmentList.appendChild(row);
  updateFragmentUI();
  requestAnimationFrame(() => autoGrow(ta));
}

function setFragmentInputs(fragments: string[]) {
  fragmentList.innerHTML = '';
  for (const f of fragments) addFragmentInput(f);
  if (fragments.length === 0) addFragmentInput();
}

btnAddFragment.addEventListener('click', () => {
  addFragmentInput();
  focusFragment(getFragmentInputs().length - 1);
});

btnGenerateQR.addEventListener('click', () => {
  handleFragments(getFragmentInputs().map(ta => ta.value));
});

async function handleFragments(values: string[]) {
  const fragments = values.filter(f => f.trim());
  if (fragments.length === 0) return;
  currentFragments = fragments;
  currentFile = null;
  if (sender) sender.destroy();
  sender = new Sender(qrCanvas, createSenderCallbacks());
  const chunkSize = parseInt(chunkSizeSlider.value);
  fileName.textContent = fragments.length > 1 ? `${fragments.length} text fragments` : 'Text';
  fileSize.textContent = formatFileSize(fragments.reduce((sum, f) => sum + new TextEncoder().encode(f).length, 0));
  await loadFragmentsInto(sender, fragments, chunkSize);
  chunkCount.textContent = sender.totalPackets > 1 ? `${sender.totalPackets} chunks` : '';
  textInputZone.classList.add('hidden');
  sendActive.classList.remove('hidden');
}

// A single fragment is sent as plain text (compatible with older receivers)
function loadFragmentsInto(s: Sender, fragments: string[], chunkSize: number) {
  return fragments.length === 1
    ? s.loadText(fragments[0], chunkSize)
    : s.loadFragments(fragments, chunkSize);
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
      // A single QR code needs no playback: just show it
      const single = total === 1;
      qrOverlay.classList.toggle('hidden', single);
      sendProgressText.classList.toggle('hidden', single);
      btnScanFeedback.classList.toggle('hidden', single);
      btnResumeAll.classList.add('hidden');
      if (single) {
        sendChunkGrid.classList.add('hidden');
        chunkGridHint.classList.add('hidden');
      } else {
        initSendChunkGrid(total);
      }
    },
    onProgress: (current: number, total: number) => {
      sendCurrent.textContent = String(current + 1);
      sendTotal.textContent = String(total);
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
  currentFragments = null;
  if (sender) sender.destroy();
  sender = new Sender(qrCanvas, createSenderCallbacks());
  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  const chunkSize = parseInt(chunkSizeSlider.value);
  await sender.loadFile(file, chunkSize);
  chunkCount.textContent = `${sender.totalPackets} chunks`;
}

// ===== Send: Controls =====
btnPlayOverlay.addEventListener('click', () => {
  if (!sender) return;
  qrOverlay.classList.add('hidden');
  sender.play();
});

chunkSizeSlider.addEventListener('input', () => { chunkSizeVal.textContent = `${chunkSizeSlider.value} B`; });
chunkSizeSlider.addEventListener('change', async () => {
  if (!sender) return;
  if (!currentFile && !currentFragments) return;
  sender.destroy();
  sender = new Sender(qrCanvas, createSenderCallbacks());
  const cs = parseInt(chunkSizeSlider.value);
  if (currentFile) await sender.loadFile(currentFile, cs);
  else if (currentFragments) await loadFragmentsInto(sender, currentFragments, cs);
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
    if (wasPlaying) { sender.play(); qrOverlay.classList.add('hidden'); }
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
  if (sender && !sender.isPlaying) { sender.play(); qrOverlay.classList.add('hidden'); }
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
  showGridHint();
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

// ===== Send: Chunk Grid Interaction =====
let gridDragging = false;
let ghostSweepDone = false;
const gridSelected = new Set<number>();

// Drag counter tooltip
const dragCounter = document.createElement('div');
dragCounter.className = 'chunk-drag-counter';
dragCounter.style.display = 'none';
document.body.appendChild(dragCounter);

function getCellIndex(el: Element | null): number {
  if (!el || !el.classList.contains('chunk-cell')) return -1;
  return Array.prototype.indexOf.call(sendChunkGrid.children, el);
}

function clearGridSelection() {
  gridSelected.clear();
  for (const cell of sendChunkGrid.children) {
    (cell as HTMLElement).classList.remove('selected');
  }
}

function selectCell(idx: number) {
  if (idx < 0) return;
  const cell = sendChunkGrid.children[idx] as HTMLElement;
  if (!cell) return;
  if (gridSelected.has(idx)) {
    gridSelected.delete(idx);
    cell.classList.remove('selected');
  } else {
    gridSelected.add(idx);
    cell.classList.add('selected');
  }
}

function updateDragCounter(x: number, y: number) {
  if (gridSelected.size < 2) {
    dragCounter.style.display = 'none';
    return;
  }
  const indices = Array.from(gridSelected).sort((a, b) => a - b);
  dragCounter.textContent = `Chunk ${indices[0]}–${indices[indices.length - 1]}`;
  dragCounter.style.display = 'block';
  dragCounter.style.left = `${x}px`;
  dragCounter.style.top = `${y}px`;
}

function hideDragCounter() {
  dragCounter.style.display = 'none';
}

function dismissHint() {
  const hint = document.getElementById('chunk-grid-hint');
  if (hint) hint.classList.add('hidden');
}

function applyGridSelection() {
  if (!sender) return;
  dismissHint();
  qrOverlay.classList.add('hidden');
  const indices = Array.from(gridSelected).sort((a, b) => a - b);
  if (indices.length === 1) {
    sender.showChunk(indices[0]);
  } else if (indices.length > 1) {
    sender.playSelection(indices);
  }
  btnResumeAll.classList.remove('hidden');
}

// Ghost sweep animation with finger cursor — starts from chunk 0 (top-left)
function startGhostSweep() {
  if (ghostSweepDone) return;
  ghostSweepDone = true;
  const cells = sendChunkGrid.children;
  const total = cells.length;
  if (total < 3) return;

  const finger = document.createElement('div');
  finger.textContent = '👆';
  finger.style.cssText = 'position:fixed;font-size:22px;pointer-events:none;z-index:100;transition:left 200ms ease,top 200ms ease;opacity:0.9;';
  document.body.appendChild(finger);

  const sweepLen = Math.min(12, total);
  let step = 0;

  function sweepStep() {
    if (step > 0) {
      (cells[step - 1] as HTMLElement).classList.remove('ghost-sweep');
    }
    if (step >= sweepLen) {
      finger.remove();
      return;
    }
    const cell = cells[step] as HTMLElement;
    cell.classList.add('ghost-sweep');
    const rect = cell.getBoundingClientRect();
    finger.style.left = `${rect.left + rect.width / 2 - 11}px`;
    finger.style.top = `${rect.bottom + 4}px`;
    step++;
    setTimeout(sweepStep, 250);
  }

  // Position finger on first cell before starting
  const first = cells[0] as HTMLElement;
  const r = first.getBoundingClientRect();
  finger.style.left = `${r.left + r.width / 2 - 11}px`;
  finger.style.top = `${r.bottom + 4}px`;
  setTimeout(sweepStep, 300);
}

function showGridHint() {
  if (ghostSweepDone) return;
  const hint = document.getElementById('chunk-grid-hint');
  if (hint) hint.classList.remove('hidden');
  setTimeout(() => { if (!ghostSweepDone) startGhostSweep(); }, 2000);
}

// Mouse events
sendChunkGrid.addEventListener('mousedown', (e) => {
  const idx = getCellIndex(e.target as Element);
  if (idx < 0) return;
  e.preventDefault();
  if (sender?.isPlaying) sender.pause();
  clearGridSelection();
  gridDragging = true;
  selectCell(idx);
});

sendChunkGrid.addEventListener('mouseover', (e) => {
  if (!gridDragging) return;
  const idx = getCellIndex(e.target as Element);
  if (idx >= 0 && !gridSelected.has(idx)) {
    selectCell(idx);
    updateDragCounter(e.clientX, e.clientY);
  }
});

sendChunkGrid.addEventListener('mousemove', (e) => {
  if (!gridDragging) return;
  updateDragCounter(e.clientX, e.clientY);
});

document.addEventListener('mouseup', () => {
  if (!gridDragging) return;
  gridDragging = false;
  hideDragCounter();
  if (gridSelected.size > 0) applyGridSelection();
});

// Touch events
sendChunkGrid.addEventListener('touchstart', (e) => {
  const touch = e.touches[0];
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  const idx = getCellIndex(el);
  if (idx < 0) return;
  e.preventDefault();
  if (sender?.isPlaying) sender.pause();
  clearGridSelection();
  gridDragging = true;
  selectCell(idx);
}, { passive: false });

sendChunkGrid.addEventListener('touchmove', (e) => {
  if (!gridDragging) return;
  e.preventDefault();
  const touch = e.touches[0];
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  const idx = getCellIndex(el);
  if (idx >= 0 && !gridSelected.has(idx)) selectCell(idx);
  updateDragCounter(touch.clientX, touch.clientY);
}, { passive: false });

document.addEventListener('touchend', () => {
  if (!gridDragging) return;
  gridDragging = false;
  hideDragCounter();
  if (gridSelected.size > 0) applyGridSelection();
});

// Resume All button
btnResumeAll.addEventListener('click', () => {
  if (!sender) return;
  clearGridSelection();
  sender.resetPlaylist();
  sender.play();
  qrOverlay.classList.add('hidden');
  btnResumeAll.classList.add('hidden');
});

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

  if (metadata.type === 'text' || metadata.type === 'fragments') {
    let fragments: string[];
    try {
      fragments = metadata.type === 'fragments'
        ? parseFragments(data)
        : [new TextDecoder().decode(data)];
    } catch (err) {
      showError(`Invalid fragment data: ${err}`);
      return;
    }
    receivedFragments = fragments;
    receivedFileData = null;
    const label = fragments.length > 1 ? `${fragments.length} text fragments` : 'Text snippet';
    const size = formatFileSize(fragments.reduce((sum, f) => sum + new TextEncoder().encode(f).length, 0));
    recvFilename.textContent = label;
    recvFilesize.textContent = size;
    recvSummary.textContent = `${label} (${size})`;
    textResult.classList.remove('hidden');
    renderFragmentResults(fragments);
    btnDownload.classList.add('hidden');
  } else {
    receivedFragments = null;
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

// ===== Receive: Fragments with Copy Buttons & Re-send =====
function renderFragmentResults(fragments: string[]) {
  fragmentResults.innerHTML = '';
  for (const fragment of fragments) {
    const row = document.createElement('div');
    row.className = 'fragment-result';
    const pre = document.createElement('pre');
    pre.textContent = fragment;
    const btn = document.createElement('button');
    btn.className = 'btn-fragment-copy';
    btn.title = 'Copy to clipboard';
    btn.innerHTML = COPY_ICON;
    btn.addEventListener('click', async () => {
      await copyToClipboard(fragment);
      for (const other of fragmentResults.querySelectorAll('.btn-fragment-copy.copied')) {
        other.classList.remove('copied');
        other.innerHTML = COPY_ICON;
      }
      btn.classList.add('copied');
      btn.innerHTML = CHECK_ICON;
      setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = COPY_ICON; }, 2000);
    });
    row.append(pre, btn);
    fragmentResults.appendChild(row);
  }
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  }
}

const btnResend = $<HTMLButtonElement>('btn-resend');
btnResend.addEventListener('click', async () => {
  if (receivedFragments) {
    switchTab('send'); switchSendMode('text');
    setFragmentInputs(receivedFragments);
    handleFragments(receivedFragments);
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
