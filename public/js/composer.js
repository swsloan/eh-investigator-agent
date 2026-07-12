import { abortSession, postMessage, uploadSessionFiles } from './api.js';
import { addSysNote } from './chat.js';
import { $, dom } from './dom.js';
import { refreshFiles } from './files.js';
import { newSession } from './sessions.js';
import { state } from './state.js';
import { fmtBytes } from './utils.js';

function renderAttachList() {
  dom.attachList.innerHTML = '';
  state.pendingFiles.forEach((file, i) => {
    const chip = document.createElement('span');
    chip.className = 'file-chip';
    chip.innerHTML = `<span class="name"></span><span class="size"></span><button class="rm" title="Remove">×</button>`;
    chip.querySelector('.name').textContent = file.name;
    chip.querySelector('.size').textContent = fmtBytes(file.size);
    chip.querySelector('.rm').addEventListener('click', () => {
      state.pendingFiles.splice(i, 1);
      renderAttachList();
    });
    dom.attachList.appendChild(chip);
  });
}

function addFiles(fileListLike) {
  for (const file of fileListLike) state.pendingFiles.push(file);
  renderAttachList();
}

async function sendMessage() {
  const text = dom.inputEl.value.trim();
  if ((!text && !state.pendingFiles.length) || state.running || !state.session) return;

  let attachments = [];
  if (state.pendingFiles.length) {
    const upload = await uploadSessionFiles(state.session.id, state.pendingFiles);
    if (!upload.ok) { addSysNote('File upload failed.'); return; }
    attachments = upload.data.files;
    state.pendingFiles = [];
    renderAttachList();
    refreshFiles();
  }

  dom.inputEl.value = '';
  dom.inputEl.style.height = 'auto';
  const response = await postMessage(state.session.id, { text, attachments });
  if (!response.ok) {
    addSysNote(response.data.error || 'Failed to send message.');
  }
}

function initDragAndDrop() {
  window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    if (event.dataTransfer?.types?.includes('Files')) {
      state.dragDepth++;
      dom.dropOverlay.classList.remove('hidden');
    }
  });
  window.addEventListener('dragleave', (event) => {
    event.preventDefault();
    if (--state.dragDepth <= 0) {
      state.dragDepth = 0;
      dom.dropOverlay.classList.add('hidden');
    }
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    state.dragDepth = 0;
    dom.dropOverlay.classList.add('hidden');
    if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
  });
}

export function initComposer() {
  dom.inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  dom.inputEl.addEventListener('input', () => {
    dom.inputEl.style.height = 'auto';
    dom.inputEl.style.height = Math.min(dom.inputEl.scrollHeight, 180) + 'px';
  });

  dom.sendBtn.addEventListener('click', sendMessage);
  dom.stopBtn.addEventListener('click', () => {
    if (state.session) abortSession(state.session.id);
  });
  dom.attachBtn.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', () => {
    addFiles(dom.fileInput.files);
    dom.fileInput.value = '';
  });
  $('new-session-btn').addEventListener('click', newSession);
  $('files-refresh').addEventListener('click', refreshFiles);

  document.querySelectorAll('.suggestion').forEach((button) => {
    button.addEventListener('click', () => {
      dom.inputEl.value = button.textContent;
      sendMessage();
    });
  });

  initDragAndDrop();
}
