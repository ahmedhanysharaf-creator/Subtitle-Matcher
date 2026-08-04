/* ═══════════════════════════════════════════
   SUBTITLE MATCHER — Pure Client Web Edition
   Hosted on GitHub Pages
   ═══════════════════════════════════════════ */

'use strict';

const BADGE_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f59e0b', '#a855f7', '#84cc16',
];

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.webm', '.flv', '.ts', '.m2ts', '.ogv', '.divx', '.3gp', '.mpg', '.mpeg'];
const SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.vtt', '.sub', '.ssa', '.sbv', '.idx'];

// App State
const state = {
  mode: 'none', // 'fs' (File System Access API) | 'upload' (File upload / Drag drop)
  dirHandle: null,
  parentHandles: [], // stack of parent directory handles for navigation
  folderName: '',
  destDirHandle: null, // Destination folder directory handle
  destFolderName: '',  // Destination folder name / path string
  subfolders: [], // [{ name, handle, path }]
  subtitles: [],  // [{ name, ext, file, handle, path, parentHandle }]
  videos: [],     // [{ name, ext, file, handle, path, parentHandle }]
  allUploadFiles: [], // For upload mode subfolder filtering
  currentSubfolderFilter: null,
  matches: [],    // [{ id, subtitle, video, number, color }]
  pendingItem: null,
  matchCounter: 0,
  sidebarCollapsed: false,
  history: loadHistoryFromStorage(),
};

function loadHistoryFromStorage() {
  try {
    const raw = localStorage.getItem('subtitle_matcher_history');
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

// DOM References
const $ = id => document.getElementById(id);
const dom = {
  selectFolderBtn:       $('select-folder-btn'),
  uploadFolderInput:     $('upload-folder-input'),
  selectDestFolderBtn:   $('select-dest-folder-btn'),
  historyBtn:            $('history-btn'),
  historyCountBadge:     $('history-count-badge'),
  autoMatchBtn:          $('auto-match-btn'),
  doneBtn:               $('done-btn'),
  modeInfo:              $('mode-info'),
  currentFolderLabel:    $('current-folder-label'),
  destFolderBadge:       $('dest-folder-badge'),
  destFolderName:        $('dest-folder-name'),
  clearDestBtn:          $('clear-dest-btn'),
  mainPanels:            $('main-panels'),
  dragOverlay:           $('drag-overlay'),
  subfoldersPanel:       $('subfolders-panel'),
  subfoldersList:        $('subfolders-list'),
  folderCount:           $('folder-count'),
  toggleSidebarBtn:      $('toggle-sidebar-btn'),
  floatingSidebarBtn:    $('floating-sidebar-btn'),
  subfolderDivider:      $('subfolder-divider'),
  subtitleList:          $('subtitle-list'),
  videoList:             $('video-list'),
  subCount:              $('sub-count'),
  vidCount:              $('vid-count'),
  matchesList:           $('matches-list'),
  matchCount:            $('match-count'),
  clearBtn:              $('clear-matches-btn'),
  modal:                 $('results-modal'),
  modalResults:          $('modal-results'),
  modalActions:          $('modal-actions'),
  modalClose:            $('modal-close-btn'),
  modalCancel:           $('modal-cancel-btn'),
  modalSubtitle:         $('modal-subtitle'),
  modalBackdrop:         $('modal-backdrop'),
  destModal:             $('dest-modal'),
  destModalBackdrop:     $('dest-modal-backdrop'),
  destBrowseDiskBtn:     $('dest-browse-disk-btn'),
  destFolderInput:       $('dest-folder-input'),
  destSaveBtn:           $('dest-save-btn'),
  destCancelBtn:         $('dest-cancel-btn'),
  subfolderChips:        $('subfolder-chips'),
  historyModal:          $('history-modal'),
  historyModalBackdrop:  $('history-modal-backdrop'),
  historySearchInput:    $('history-search-input'),
  exportHistoryBtn:      $('export-history-btn'),
  clearHistoryBtn:       $('clear-history-btn'),
  historyList:           $('history-list'),
  historyCloseBtn:       $('history-close-btn'),
  editHistoryModal:      $('edit-history-modal'),
  editHistoryBackdrop:   $('edit-history-backdrop'),
  editSubOriginal:       $('edit-sub-original'),
  editVidName:           $('edit-vid-name'),
  editSubNew:            $('edit-sub-new'),
  editDestFolder:        $('edit-dest-folder'),
  editHistoryCancelBtn:  $('edit-history-cancel-btn'),
  editHistorySaveBtn:    $('edit-history-save-btn'),
  toast:                 $('toast'),
  loading:               $('loading-overlay'),
  loadingText:           $('loading-text'),
};

// Natural Sort
const naturalSort = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

// ─────────────────────────────────────────────────────────
// File System Access API (Local Disk Access)
// ─────────────────────────────────────────────────────────
async function openDirectoryPicker() {
  if (!('showDirectoryPicker' in window)) {
    showToast('Folder disk access not supported in this browser. Please use "Upload Files / Folder"', 'warning');
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await loadDirectoryHandle(handle, true);
    showToast(`Loaded folder: ${handle.name}`, 'success');
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('❌ Could not open folder: ' + err.message, 'error');
    }
  }
}

async function loadDirectoryHandle(handle, isRoot = false) {
  showLoading('Scanning folder files & subfolders…');
  try {
    if (isRoot) {
      state.parentHandles = [];
    }

    state.mode = 'fs';
    state.dirHandle = handle;
    state.folderName = handle.name;
    state.subfolders = [];
    state.subtitles = [];
    state.videos = [];
    state.pendingItem = null;

    for await (const entry of handle.values()) {
      const isDir = entry.kind === 'directory' || (entry.kind === undefined && entry.isDirectory);
      const isFile = entry.kind === 'file' || (entry.kind === undefined && entry.isFile);

      if (isDir) {
        state.subfolders.push({ name: entry.name, handle: entry, path: entry.name });
      } else if (isFile || entry.kind === 'file') {
        const ext = getFileExt(entry.name);
        if (SUBTITLE_EXTENSIONS.includes(ext)) {
          state.subtitles.push({ name: entry.name, ext, handle: entry, path: entry.name, parentHandle: handle });
        } else if (VIDEO_EXTENSIONS.includes(ext)) {
          state.videos.push({ name: entry.name, ext, handle: entry, path: entry.name, parentHandle: handle });
        }
      }
    }

    state.subfolders.sort(naturalSort);
    state.subtitles.sort(naturalSort);
    state.videos.sort(naturalSort);

    updateModeLabel(`Local Disk Folder: <strong>${escapeHtml(handle.name)}</strong> (${state.subfolders.length} subfolder${state.subfolders.length !== 1 ? 's' : ''})`);
    renderAll();
    updateDoneButton();
  } catch (err) {
    showToast('❌ Failed to read directory: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

// ─────────────────────────────────────────────────────────
// Drag & Drop / File Input Processing
// ─────────────────────────────────────────────────────────
function processFileList(files, folderName = 'Uploaded Files') {
  showLoading('Processing uploaded files & folders…');

  state.mode = 'upload';
  state.dirHandle = null;
  state.parentHandles = [];
  state.folderName = folderName;
  state.allUploadFiles = Array.from(files);
  state.subfolders = [];
  state.subtitles = [];
  state.videos = [];
  state.pendingItem = null;
  state.currentSubfolderFilter = null;

  const subfolderMap = new Map();

  state.allUploadFiles.forEach(file => {
    const relPath = file.webkitRelativePath || file.name;
    const parts = relPath.split('/').filter(Boolean);

    let subfolderName = null;
    if (parts.length > 2) {
      subfolderName = parts[1]; // Subfolder inside root selected folder
    } else if (parts.length === 2) {
      subfolderName = parts[0];
    }

    if (subfolderName) {
      if (!subfolderMap.has(subfolderName)) {
        subfolderMap.set(subfolderName, { name: subfolderName, path: subfolderName });
      }
    }

    const ext = getFileExt(file.name);
    if (SUBTITLE_EXTENSIONS.includes(ext)) {
      state.subtitles.push({ name: file.name, ext, file, path: relPath, subfolder: subfolderName });
    } else if (VIDEO_EXTENSIONS.includes(ext)) {
      state.videos.push({ name: file.name, ext, file, path: relPath, subfolder: subfolderName });
    }
  });

  state.subfolders = Array.from(subfolderMap.values());
  state.subfolders.sort(naturalSort);
  state.subtitles.sort(naturalSort);
  state.videos.sort(naturalSort);

  updateModeLabel(`Uploaded Mode: <strong>${escapeHtml(folderName)}</strong> (${state.subfolders.length} subfolders)`);
  renderAll();
  updateDoneButton();
  hideLoading();
  showToast(`Loaded ${state.subtitles.length} subtitles & ${state.videos.length} films (${state.subfolders.length} subfolders)`, 'success');
}

function filterUploadSubfolder(subfolderName) {
  state.currentSubfolderFilter = subfolderName;
  showLoading(subfolderName ? `Loading subfolder ${subfolderName}…` : 'Loading all files…');

  const filteredSubs = [];
  const filteredVids = [];

  state.allUploadFiles.forEach(file => {
    const relPath = file.webkitRelativePath || file.name;
    const parts = relPath.split('/').filter(Boolean);

    let belongs = false;
    if (!subfolderName) {
      belongs = true; // All files
    } else if (parts.length > 2 && parts[1] === subfolderName) {
      belongs = true;
    } else if (parts.length === 2 && parts[0] === subfolderName) {
      belongs = true;
    }

    if (belongs) {
      const ext = getFileExt(file.name);
      if (SUBTITLE_EXTENSIONS.includes(ext)) {
        filteredSubs.push({ name: file.name, ext, file, path: relPath });
      } else if (VIDEO_EXTENSIONS.includes(ext)) {
        filteredVids.push({ name: file.name, ext, file, path: relPath });
      }
    }
  });

  state.subtitles = filteredSubs.sort(naturalSort);
  state.videos = filteredVids.sort(naturalSort);

  updateModeLabel(subfolderName ? `Subfolder: <strong>${escapeHtml(subfolderName)}</strong>` : `Uploaded Mode: <strong>${escapeHtml(state.folderName)}</strong>`);
  renderAll();
  hideLoading();
}

// Helpers
function getFileExt(filename) {
  const idx = filename.lastIndexOf('.');
  return idx !== -1 ? filename.slice(idx).toLowerCase() : '';
}

function getBaseName(filename) {
  const idx = filename.lastIndexOf('.');
  return idx !== -1 ? filename.slice(0, idx) : filename;
}

// ─────────────────────────────────────────────────────────
// Sidebar Minimize / Maximize Toggle
// ─────────────────────────────────────────────────────────
function toggleSidebar(collapse) {
  state.sidebarCollapsed = typeof collapse === 'boolean' ? collapse : !state.sidebarCollapsed;
  dom.subfoldersPanel.classList.toggle('collapsed', state.sidebarCollapsed);
  dom.subfolderDivider.classList.toggle('collapsed', state.sidebarCollapsed);
  dom.floatingSidebarBtn.classList.toggle('hidden', !state.sidebarCollapsed);
}

// ─────────────────────────────────────────────────────────
// Matching Logic
// ─────────────────────────────────────────────────────────
function getMatchForItem(type, item) {
  return state.matches.find(m =>
    type === 'subtitle'
      ? m.subtitle.name === item.name
      : m.video.name    === item.name
  ) || null;
}

function isPending(type, item) {
  return !!state.pendingItem &&
    state.pendingItem.type === type &&
    state.pendingItem.item.name === item.name;
}

function handleItemClick(type, item) {
  if (getMatchForItem(type, item)) return;

  const pending = state.pendingItem;

  if (!pending) {
    state.pendingItem = { type, item };
    renderAll();
    return;
  }

  if (pending.type === type) {
    state.pendingItem = pending.item.name === item.name ? null : { type, item };
    renderAll();
    return;
  }

  const subtitle = type === 'subtitle' ? item : pending.item;
  const video    = type === 'video'    ? item : pending.item;

  state.matchCounter++;
  const color = BADGE_COLORS[(state.matchCounter - 1) % BADGE_COLORS.length];

  state.matches.push({
    id: Date.now() + Math.random(),
    subtitle,
    video,
    number: state.matchCounter,
    color,
  });

  state.pendingItem = null;
  renderAll();
  updateDoneButton();
}

function removeMatch(matchId) {
  const idx = state.matches.findIndex(m => m.id === matchId);
  if (idx === -1) return;
  state.matches.splice(idx, 1);
  state.matches.forEach((m, i) => {
    m.number = i + 1;
    m.color  = BADGE_COLORS[i % BADGE_COLORS.length];
  });
  state.matchCounter = state.matches.length;
  renderAll();
  updateDoneButton();
}

function clearAllMatches() {
  state.matches = [];
  state.matchCounter = 0;
  state.pendingItem = null;
  renderAll();
  updateDoneButton();
}

// ─────────────────────────────────────────────────────────
// Smart Auto-Matching Logic
// ─────────────────────────────────────────────────────────
function extractEpisodeKey(filename) {
  const cleanName = filename.toLowerCase();

  const sEpMatch = cleanName.match(/s(\d+)\s*e(\d+)|(\d+)x(\d+)/i);
  if (sEpMatch) {
    const season = parseInt(sEpMatch[1] || sEpMatch[3], 10);
    const episode = parseInt(sEpMatch[2] || sEpMatch[4], 10);
    return `S${season}E${episode}`;
  }

  const epMatch = cleanName.match(/(?:ep|episode|e)[._\s-]*(\d+)/i);
  if (epMatch) {
    const episode = parseInt(epMatch[1], 10);
    return `E${episode}`;
  }

  const numMatch = cleanName.match(/(?:^|[\s._\-\[\(])(\d{1,3})(?:$|[\s._\-\]\)])/);
  if (numMatch) {
    return `NUM_${parseInt(numMatch[1], 10)}`;
  }

  return null;
}

function autoMatch() {
  const unmatchedSubs = state.subtitles.filter(s => !getMatchForItem('subtitle', s));
  const unmatchedVids = state.videos.filter(v => !getMatchForItem('video', v));

  if (unmatchedSubs.length === 0 || unmatchedVids.length === 0) {
    showToast('No unmatched subtitle and film files available', 'info');
    return;
  }

  let matchedCount = 0;

  const vidKeyMap = new Map();
  unmatchedVids.forEach(v => {
    const key = extractEpisodeKey(v.name);
    if (key && !vidKeyMap.has(key)) {
      vidKeyMap.set(key, v);
    }
  });

  const remainingSubs = [];
  unmatchedSubs.forEach(sub => {
    const subKey = extractEpisodeKey(sub.name);
    if (subKey && vidKeyMap.has(subKey)) {
      const vid = vidKeyMap.get(subKey);
      vidKeyMap.delete(subKey);

      state.matchCounter++;
      const color = BADGE_COLORS[(state.matchCounter - 1) % BADGE_COLORS.length];
      state.matches.push({
        id: Date.now() + Math.random(),
        subtitle: sub,
        video: vid,
        number: state.matchCounter,
        color,
      });
      matchedCount++;
    } else {
      remainingSubs.push(sub);
    }
  });

  const remainingVids = unmatchedVids.filter(v => !state.matches.some(m => m.video.name === v.name));
  if (matchedCount === 0 && remainingSubs.length > 0 && remainingSubs.length === remainingVids.length) {
    for (let i = 0; i < remainingSubs.length; i++) {
      state.matchCounter++;
      const color = BADGE_COLORS[(state.matchCounter - 1) % BADGE_COLORS.length];
      state.matches.push({
        id: Date.now() + Math.random(),
        subtitle: remainingSubs[i],
        video: remainingVids[i],
        number: state.matchCounter,
        color,
      });
      matchedCount++;
    }
  }

  state.pendingItem = null;
  renderAll();
  updateDoneButton();

  if (matchedCount > 0) {
    showToast(`✨ Automatically matched ${matchedCount} pair${matchedCount > 1 ? 's' : ''}!`, 'success');
  } else {
    showToast('Could not auto-determine matching pairs', 'info');
  }
}

// ─────────────────────────────────────────────────────────
// Destination Folder Handling
// ─────────────────────────────────────────────────────────
function openDestDirectoryPicker() {
  openDestModal();
}

function setDestinationFolder(handle, name) {
  state.destDirHandle = handle || null;
  state.destFolderName = name || '';
  updateDestFolderUI();
}

function clearDestinationFolder() {
  state.destDirHandle = null;
  state.destFolderName = '';
  updateDestFolderUI();
  showToast('Destination folder cleared (files will stay in source folder)', 'info');
}

function updateDestFolderUI() {
  const hasDest = !!(state.destDirHandle || (state.destFolderName && state.destFolderName.trim()));
  if (hasDest) {
    if (dom.destFolderBadge) dom.destFolderBadge.classList.remove('hidden');
    if (dom.destFolderName) dom.destFolderName.textContent = `Dest: ${state.destFolderName}`;
    if (dom.selectDestFolderBtn) {
      dom.selectDestFolderBtn.classList.add('active-dest');
      dom.selectDestFolderBtn.title = `Destination set to: ${state.destFolderName}`;
    }
    if (dom.doneBtn) dom.doneBtn.title = `Apply matches and move files to ${state.destFolderName}`;
  } else {
    if (dom.destFolderBadge) dom.destFolderBadge.classList.add('hidden');
    if (dom.destFolderName) dom.destFolderName.textContent = 'Destination: None';
    if (dom.selectDestFolderBtn) {
      dom.selectDestFolderBtn.classList.remove('active-dest');
      dom.selectDestFolderBtn.title = 'Select destination folder where matched movies & subtitles will be moved';
    }
    if (dom.doneBtn) dom.doneBtn.title = 'Apply matches and rename subtitles';
  }
}

function openDestModal() {
  if (!dom.destModal) return;
  if (dom.destFolderInput) dom.destFolderInput.value = state.destFolderName || '';

  if (dom.subfolderChips) {
    dom.subfolderChips.innerHTML = '';
    if (state.subfolders && state.subfolders.length > 0) {
      state.subfolders.forEach(sub => {
        const chip = document.createElement('button');
        chip.className = 'subfolder-chip';
        chip.textContent = sub.name;
        chip.addEventListener('click', () => {
          if (dom.destFolderInput) dom.destFolderInput.value = sub.name;
          if (sub.handle) {
            setDestinationFolder(sub.handle, sub.name);
            closeDestModal();
            showToast(`🎯 Destination set to subfolder: ${sub.name}`, 'success');
          }
        });
        dom.subfolderChips.appendChild(chip);
      });
    } else {
      dom.subfolderChips.innerHTML = '<span class="suggestion-label">No subfolders loaded yet</span>';
    }
  }

  dom.destModal.classList.remove('hidden');
}

function closeDestModal() {
  if (dom.destModal) dom.destModal.classList.add('hidden');
}

function saveDestModalInput() {
  const val = dom.destFolderInput ? dom.destFolderInput.value.trim() : '';
  if (val) {
    setDestinationFolder(null, val);
    showToast(`🎯 Destination set to: ${val}`, 'success');
  } else {
    clearDestinationFolder();
  }
  closeDestModal();
}

async function removeSourceFile(item) {
  if (state.mode !== 'fs') return false;
  const candidateParents = [item.parentHandle, state.dirHandle].filter(Boolean);

  for (const parent of candidateParents) {
    try {
      if (state.destDirHandle) {
        try {
          if (await state.destDirHandle.isSameEntry(parent)) continue;
        } catch (_) {}
      }
      await parent.removeEntry(item.name);
      return true;
    } catch (_) {}
  }

  // Lock release retry loop for Windows OS file handle delays
  for (let attempt = 1; attempt <= 3; attempt++) {
    await new Promise(r => setTimeout(r, 120 * attempt));
    for (const parent of candidateParents) {
      try {
        await parent.removeEntry(item.name);
        return true;
      } catch (_) {}
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────
// Apply Matches Workflow (Preview Modal -> Done -> Loading & Move)
// ─────────────────────────────────────────────────────────
function applyMatches() {
  if (state.matches.length === 0) {
    showToast('No matched pairs to apply', 'info');
    return;
  }
  showMatchesPreviewModal();
}

function showMatchesPreviewModal() {
  dom.modalResults.innerHTML = '';

  const destName = state.destFolderName || 'Source Folder (In-place)';

  if (dom.modalSubtitle) {
    dom.modalSubtitle.textContent = `Review matched pairs below. Click "Done" to move files to: ${destName}`;
  }

  const banner = document.createElement('div');
  banner.className = 'result-dest-banner';
  banner.style.marginBottom = '12px';
  banner.style.padding = '8px 12px';
  banner.style.borderRadius = 'var(--radius-md)';
  banner.style.background = 'rgba(6, 182, 212, 0.12)';
  banner.style.border = '1px solid rgba(6, 182, 212, 0.3)';
  banner.style.fontSize = '12px';
  banner.style.color = '#7dd3fc';
  banner.innerHTML = `🎯 Target Location: <strong>${escapeHtml(destName)}</strong> (${state.matches.length} pair${state.matches.length !== 1 ? 's' : ''})`;
  dom.modalResults.appendChild(banner);

  state.matches.forEach(match => {
    const videoBase = getBaseName(match.video.name);
    const subExt = match.subtitle.ext;
    const newSubFileName = videoBase + subExt;

    const row = document.createElement('div');
    row.className = 'result-row success';

    const icon = document.createElement('span');
    icon.className = 'result-icon';
    icon.textContent = '📄';

    const text = document.createElement('div');
    text.className = 'result-text';
    text.innerHTML = `
      <div class="result-label" style="font-size:12px;">${escapeHtml(match.subtitle.name)} <span style="color:#06b6d4;font-weight:700;">➔</span> <strong>${escapeHtml(newSubFileName)}</strong></div>
      <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">🎬 Film: ${escapeHtml(match.video.name)}</div>
    `;

    row.appendChild(icon);
    row.appendChild(text);
    dom.modalResults.appendChild(row);
  });

  if (dom.modalClose) dom.modalClose.textContent = 'Done';
  dom.modal.classList.remove('hidden');
}

async function getOrCreateSubdirectoryHandle(rootDirHandle, folderPath) {
  if (!rootDirHandle || !folderPath) return null;
  const parts = folderPath.replace(/\\/g, '/').split('/').map(p => p.trim()).filter(Boolean);
  let currentHandle = rootDirHandle;
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
  }
  return currentHandle;
}

async function executeMoveOperations() {
  if (state.matches.length === 0) {
    showToast('No matched pairs to process', 'info');
    return;
  }

  // Auto-resolve destination directory handle recursively if user specified a destination folder path/name
  if (!state.destDirHandle && state.destFolderName && state.destFolderName.trim() && state.dirHandle) {
    try {
      state.destDirHandle = await getOrCreateSubdirectoryHandle(state.dirHandle, state.destFolderName.trim());
    } catch (err) {
      console.warn('Could not resolve directory handle for destination folder:', err);
    }
  }

  const hasDest = !!state.destDirHandle;
  const destName = state.destFolderName || 'destination folder';

  showLoading(hasDest ? `Moving movies & subtitles to ${destName}…` : 'Processing matches…');
  const results = [];

  try {
    if (state.destDirHandle) {
      // Move BOTH Subtitle AND Video files directly to Destination Handle
      for (let i = 0; i < state.matches.length; i++) {
        const match = state.matches[i];
        const videoBase = getBaseName(match.video.name);
        const subExt = match.subtitle.ext;
        const newSubFileName = videoBase + subExt;
        const videoFileName = match.video.name;

        showLoading(`Moving pair ${i + 1} of ${state.matches.length}: ${videoFileName}…`);

        try {
          // 1. Move & Rename Subtitle File
          let subMoved = false;
          if (match.subtitle.handle && typeof match.subtitle.handle.move === 'function') {
            try {
              await match.subtitle.handle.move(state.destDirHandle, newSubFileName);
              subMoved = true;
            } catch (_) {}
          }

          if (!subMoved) {
            let subFileObj = match.subtitle.file;
            if (!subFileObj && match.subtitle.handle) subFileObj = await match.subtitle.handle.getFile();

            if (subFileObj) {
              const destSubHandle = await state.destDirHandle.getFileHandle(newSubFileName, { create: true });
              const subWritable = await destSubHandle.createWritable();
              await subWritable.write(subFileObj);
              await subWritable.close();
              subFileObj = null;
              await removeSourceFile(match.subtitle);
            } else {
              throw new Error('Subtitle file data unavailable');
            }
          }

          // 2. Move Video File
          let vidMoved = false;
          if (match.video.handle && typeof match.video.handle.move === 'function') {
            try {
              await match.video.handle.move(state.destDirHandle, videoFileName);
              vidMoved = true;
            } catch (_) {}
          }

          if (!vidMoved) {
            let vidFileObj = match.video.file;
            if (!vidFileObj && match.video.handle) vidFileObj = await match.video.handle.getFile();

            if (vidFileObj) {
              const destVidHandle = await state.destDirHandle.getFileHandle(videoFileName, { create: true });
              const vidWritable = await destVidHandle.createWritable();
              await vidWritable.write(vidFileObj);
              await vidWritable.close();
              vidFileObj = null;
              await removeSourceFile(match.video);
            }
          }

          addHistoryRecord({
            originalSub: match.subtitle.name,
            originalVid: match.video.name,
            newSub: newSubFileName,
            destFolder: state.destFolderName || 'Destination Folder',
            status: 'Success'
          });

          results.push({
            success: true,
            oldName: match.subtitle.name,
            newName: `${newSubFileName} & ${videoFileName}`,
            note: `Moved to ${destName}`
          });
        } catch (err) {
          results.push({ success: false, oldName: match.subtitle.name, error: err.message });
        }
      }

      hideLoading();

      state.matches = [];
      state.matchCounter = 0;
      renderAll();
      updateDoneButton();

      if (state.mode === 'fs' && state.dirHandle) {
        await loadDirectoryHandle(state.dirHandle, false);
      }

      const successCount = results.filter(r => r.success).length;
      showToast(`✅ Successfully moved & renamed ${successCount} pair(s) to ${destName}!`, 'success');
    } else if (state.mode === 'fs' && state.dirHandle) {
      // In-place rename in source directory
      for (let i = 0; i < state.matches.length; i++) {
        const match = state.matches[i];
        const videoBase = getBaseName(match.video.name);
        const subExt = match.subtitle.ext;
        const newFileName = videoBase + subExt;

        showLoading(`Renaming subtitle ${i + 1} of ${state.matches.length}: ${newFileName}…`);

        try {
          if (match.subtitle.name === newFileName) {
            results.push({ success: true, oldName: match.subtitle.name, newName: newFileName, note: 'Already matching' });
            continue;
          }

          if ('move' in match.subtitle.handle) {
            try {
              await match.subtitle.handle.move(newFileName);
            } catch (_) {
              const file = await match.subtitle.handle.getFile();
              const sourceParent = match.subtitle.parentHandle || state.dirHandle;
              const newHandle = await sourceParent.getFileHandle(newFileName, { create: true });
              const writable = await newHandle.createWritable();
              await writable.write(file);
              await writable.close();
              try { await sourceParent.removeEntry(match.subtitle.name); } catch (_) {}
            }
          } else {
            const file = await match.subtitle.handle.getFile();
            const sourceParent = match.subtitle.parentHandle || state.dirHandle;
            const newHandle = await sourceParent.getFileHandle(newFileName, { create: true });
            const writable = await newHandle.createWritable();
            await writable.write(file);
            await writable.close();
            try { await sourceParent.removeEntry(match.subtitle.name); } catch (_) {}
          }

          addHistoryRecord({
            originalSub: match.subtitle.name,
            originalVid: match.video.name,
            newSub: newFileName,
            destFolder: 'Source Folder (In-place)',
            status: 'Success'
          });

          results.push({ success: true, oldName: match.subtitle.name, newName: newFileName });
        } catch (err) {
          results.push({ success: false, oldName: match.subtitle.name, error: err.message });
        }
      }

      hideLoading();

      state.matches = [];
      state.matchCounter = 0;
      renderAll();
      updateDoneButton();

      if (state.dirHandle) {
        await loadDirectoryHandle(state.dirHandle, false);
      }

      const successCount = results.filter(r => r.success).length;
      showToast(`✅ Successfully renamed ${successCount} subtitle file(s)!`, 'success');
    } else {
      // Upload / Web Mode with ZIP Download
      const zip = typeof JSZip !== 'undefined' ? new JSZip() : null;
      const downloadItems = [];
      const folderPrefix = state.destFolderName && state.destFolderName.trim() ? state.destFolderName.trim() + '/' : '';

      for (let i = 0; i < state.matches.length; i++) {
        const match = state.matches[i];
        const videoBase = getBaseName(match.video.name);
        const subExt = match.subtitle.ext;
        const newFileName = videoBase + subExt;

        showLoading(`Preparing file ${i + 1} of ${state.matches.length}…`);

        try {
          let fileObj = match.subtitle.file;
          if (!fileObj && match.subtitle.handle) {
            fileObj = await match.subtitle.handle.getFile();
          }

          if (fileObj) {
            if (zip) {
              zip.file(folderPrefix + newFileName, fileObj);
              if (match.video.file) {
                zip.file(folderPrefix + match.video.name, match.video.file);
              }
            }
            downloadItems.push({ file: fileObj, newName: folderPrefix + newFileName });

            addHistoryRecord({
              originalSub: match.subtitle.name,
              originalVid: match.video.name,
              newSub: folderPrefix + newFileName,
              destFolder: state.destFolderName || 'ZIP Download',
              status: 'Success'
            });

            results.push({ success: true, oldName: match.subtitle.name, newName: folderPrefix + newFileName });
          } else {
            throw new Error('File data unavailable');
          }
        } catch (err) {
          results.push({ success: false, oldName: match.subtitle.name, error: err.message });
        }
      }

      hideLoading();

      if (zip) {
        showLoading('Generating ZIP package…');
        const blob = await zip.generateAsync({ type: 'blob' });
        triggerDownload(blob, 'renamed_subtitles.zip');
        hideLoading();
        showToast('📦 Downloaded renamed files package!', 'success');
      }

      state.matches = [];
      state.matchCounter = 0;
      renderAll();
      updateDoneButton();
    }
  } catch (err) {
    hideLoading();
    showToast('❌ Execution failed: ' + err.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────
// Action & Rename History System
// ─────────────────────────────────────────────────────────
let editingHistoryId = null;

function saveHistoryToStorage() {
  try {
    localStorage.setItem('subtitle_matcher_history', JSON.stringify(state.history));
  } catch (_) {}
  updateHistoryBadge();
}

function addHistoryRecord(record) {
  const item = {
    id: Date.now() + Math.random(),
    timestamp: new Date().toLocaleString(),
    originalSub: record.originalSub,
    originalVid: record.originalVid,
    newSub: record.newSub,
    destFolder: record.destFolder || (state.destFolderName ? state.destFolderName : 'Source Folder'),
    status: record.status || 'Success'
  };

  state.history.unshift(item);
  saveHistoryToStorage();
}

function updateHistoryBadge() {
  if (dom.historyCountBadge) {
    dom.historyCountBadge.textContent = state.history.length;
  }
}

function openHistoryModal() {
  if (!dom.historyModal) return;
  renderHistoryList();
  dom.historyModal.classList.remove('hidden');
}

function closeHistoryModal() {
  if (dom.historyModal) dom.historyModal.classList.add('hidden');
}

function renderHistoryList(filterText = '') {
  if (!dom.historyList) return;
  dom.historyList.innerHTML = '';

  const cleanFilter = filterText.toLowerCase().trim();
  const filtered = state.history.filter(h => {
    if (!cleanFilter) return true;
    return (
      (h.originalSub && h.originalSub.toLowerCase().includes(cleanFilter)) ||
      (h.originalVid && h.originalVid.toLowerCase().includes(cleanFilter)) ||
      (h.newSub && h.newSub.toLowerCase().includes(cleanFilter)) ||
      (h.destFolder && h.destFolder.toLowerCase().includes(cleanFilter))
    );
  });

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `<div class="splash-icon">📜</div><p>${cleanFilter ? 'No matching history entries found' : 'No history recorded yet. Matches will appear here after you click Apply Matches.'}</p>`;
    dom.historyList.appendChild(empty);
    return;
  }

  filtered.forEach(item => {
    const card = document.createElement('div');
    card.className = 'history-card';

    const header = document.createElement('div');
    header.className = 'history-card-header';
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'history-time';
    timeSpan.textContent = `⏱️ ${item.timestamp}`;

    const destTag = document.createElement('span');
    destTag.className = 'history-dest-tag';
    destTag.textContent = `🎯 ${item.destFolder}`;

    header.appendChild(timeSpan);
    header.appendChild(destTag);

    const body = document.createElement('div');
    body.className = 'history-card-body';

    body.innerHTML = `
      <div class="history-row-item">
        <span class="history-label">Subtitle:</span>
        <span class="history-val">${escapeHtml(item.originalSub)} <span class="history-arrow">➔</span> ${escapeHtml(item.newSub)}</span>
      </div>
      <div class="history-row-item">
        <span class="history-label">Film / Episode:</span>
        <span class="history-val">🎬 ${escapeHtml(item.originalVid)}</span>
      </div>
    `;

    const actions = document.createElement('div');
    actions.className = 'history-card-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'hist-btn edit-hist-btn';
    editBtn.innerHTML = '✏️ Edit Record';
    editBtn.addEventListener('click', () => openEditHistoryModal(item.id));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'hist-btn delete-hist-btn';
    deleteBtn.innerHTML = '🗑️ Delete';
    deleteBtn.addEventListener('click', () => deleteHistoryRecord(item.id));

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(actions);

    dom.historyList.appendChild(card);
  });
}

function openEditHistoryModal(id) {
  const record = state.history.find(h => h.id === id);
  if (!record) return;

  editingHistoryId = id;
  dom.editSubOriginal.value = record.originalSub || '';
  dom.editVidName.value = record.originalVid || '';
  dom.editSubNew.value = record.newSub || '';
  dom.editDestFolder.value = record.destFolder || '';

  dom.editHistoryModal.classList.remove('hidden');
}

function closeEditHistoryModal() {
  editingHistoryId = null;
  if (dom.editHistoryModal) dom.editHistoryModal.classList.add('hidden');
}

function saveEditHistoryModal() {
  if (!editingHistoryId) return;
  const record = state.history.find(h => h.id === editingHistoryId);
  if (record) {
    record.originalSub = dom.editSubOriginal.value.trim() || record.originalSub;
    record.originalVid = dom.editVidName.value.trim() || record.originalVid;
    record.newSub = dom.editSubNew.value.trim() || record.newSub;
    record.destFolder = dom.editDestFolder.value.trim() || record.destFolder;

    saveHistoryToStorage();
    renderHistoryList(dom.historySearchInput ? dom.historySearchInput.value : '');
    showToast('✏️ History entry updated successfully', 'success');
  }
  closeEditHistoryModal();
}

function deleteHistoryRecord(id) {
  const idx = state.history.findIndex(h => h.id === id);
  if (idx !== -1) {
    state.history.splice(idx, 1);
    saveHistoryToStorage();
    renderHistoryList(dom.historySearchInput ? dom.historySearchInput.value : '');
    showToast('Deleted history entry', 'info');
  }
}

function clearAllHistory() {
  if (state.history.length === 0) return;
  state.history = [];
  saveHistoryToStorage();
  renderHistoryList();
  showToast('All history cleared', 'info');
}

function exportHistoryLog() {
  if (state.history.length === 0) {
    showToast('No history available to export', 'warning');
    return;
  }

  const jsonStr = JSON.stringify(state.history, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  triggerDownload(blob, `subtitle_matcher_history_${Date.now()}.json`);
  showToast('📥 History log exported successfully', 'success');
}

// ─────────────────────────────────────────────────────────
// Rendering UI
// ─────────────────────────────────────────────────────────
function renderAll() {
  renderSubfoldersList();
  renderSubtitleList();
  renderVideoList();
  renderMatchesList();
}

function renderSubfoldersList() {
  const container = dom.subfoldersList;
  container.innerHTML = '';

  dom.folderCount.textContent = state.subfolders.length;

  // Parent Folder item (File System Access mode)
  if (state.parentHandles.length > 0) {
    const backItem = document.createElement('div');
    backItem.className = 'list-item folder-item parent-folder-item';

    const icon = document.createElement('span');
    icon.className = 'item-icon';
    icon.textContent = '⬆️';

    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = '.. (Parent Folder)';

    backItem.appendChild(icon);
    backItem.appendChild(name);
    backItem.addEventListener('click', () => {
      const parent = state.parentHandles.pop();
      if (parent) loadDirectoryHandle(parent, false);
    });
    container.appendChild(backItem);
  }

  // All Files option (Upload mode)
  if (state.mode === 'upload' && state.subfolders.length > 0) {
    const allItem = document.createElement('div');
    allItem.className = 'list-item folder-item' + (!state.currentSubfolderFilter ? ' active-folder' : '');

    const icon = document.createElement('span');
    icon.className = 'item-icon';
    icon.textContent = '📁';

    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = 'All Files';

    allItem.appendChild(icon);
    allItem.appendChild(name);
    allItem.addEventListener('click', () => filterUploadSubfolder(null));
    container.appendChild(allItem);
  }

  if (state.subfolders.length === 0 && state.parentHandles.length === 0) {
    container.appendChild(makeEmptyState('No subfolders found in directory'));
    return;
  }

  state.subfolders.forEach(subfolder => {
    const el = document.createElement('div');
    el.className = 'list-item folder-item' + (state.currentSubfolderFilter === subfolder.name ? ' active-folder' : '');

    const icon = document.createElement('span');
    icon.className = 'item-icon';
    icon.textContent = '📁';

    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = subfolder.name;
    name.title = subfolder.name;

    const arrow = document.createElement('span');
    arrow.className = 'folder-arrow';
    arrow.textContent = '→';

    el.appendChild(icon);
    el.appendChild(name);
    el.appendChild(arrow);

    el.addEventListener('click', () => {
      if (state.mode === 'fs' && subfolder.handle) {
        state.parentHandles.push(state.dirHandle);
        loadDirectoryHandle(subfolder.handle, false);
      } else if (state.mode === 'upload') {
        filterUploadSubfolder(subfolder.name);
      }
    });

    container.appendChild(el);
  });
}

function renderSubtitleList() {
  const container = dom.subtitleList;
  container.innerHTML = '';

  const matchedCount = state.subtitles.filter(s => getMatchForItem('subtitle', s)).length;
  dom.subCount.textContent = `${state.subtitles.length} file${state.subtitles.length !== 1 ? 's' : ''}, ${matchedCount} matched`;

  if (state.subtitles.length === 0) {
    container.appendChild(makeEmptyState('No subtitle files loaded (.srt, .ass, .vtt)'));
    return;
  }

  state.subtitles.forEach(sub => {
    const match   = getMatchForItem('subtitle', sub);
    const pending = isPending('subtitle', sub);
    container.appendChild(makeFileItem('subtitle', sub, match, pending));
  });
}

function renderVideoList() {
  const container = dom.videoList;
  container.innerHTML = '';

  const matchedCount = state.videos.filter(v => getMatchForItem('video', v)).length;
  dom.vidCount.textContent = `${state.videos.length} file${state.videos.length !== 1 ? 's' : ''}, ${matchedCount} matched`;

  if (state.videos.length === 0) {
    container.appendChild(makeEmptyState('No film/episode files loaded (.mp4, .mkv, .avi)'));
    return;
  }

  state.videos.forEach(vid => {
    const match   = getMatchForItem('video', vid);
    const pending = isPending('video', vid);
    container.appendChild(makeFileItem('video', vid, match, pending));
  });
}

function renderMatchesList() {
  const container = dom.matchesList;
  container.innerHTML = '';

  dom.matchCount.textContent = `${state.matches.length} pair${state.matches.length !== 1 ? 's' : ''}`;

  if (state.matches.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'no-matches-msg';
    msg.textContent = 'No matches yet — click ✨ Auto Match or pair subtitles and films manually.';
    container.appendChild(msg);
    return;
  }

  state.matches.forEach(match => container.appendChild(makeMatchChip(match)));
}

function makeEmptyState(text) {
  const el = document.createElement('div');
  el.className = 'empty-state';
  const icon = document.createElement('div');
  icon.className = 'splash-icon';
  icon.textContent = '🔍';
  const p = document.createElement('p');
  p.textContent = text;
  el.appendChild(icon);
  el.appendChild(p);
  return el;
}

function makeFileItem(type, item, match, pending) {
  const el = document.createElement('div');
  el.className = 'list-item ' + type + '-item'
    + (match   ? ' matched' : '')
    + (pending ? ' pending' : '');

  if (match) {
    el.style.borderLeftColor = match.color;
    const badge = document.createElement('span');
    badge.className = 'match-badge';
    badge.style.background = match.color;
    badge.textContent = match.number;
    el.appendChild(badge);
  }

  const icon = document.createElement('span');
  icon.className = 'item-icon';
  icon.textContent = type === 'subtitle' ? '📄' : '🎬';

  const name = document.createElement('span');
  name.className = 'item-name';
  name.textContent = item.name;
  name.title = item.name;

  el.appendChild(icon);
  el.appendChild(name);

  if (!match) {
    el.addEventListener('click', () => handleItemClick(type, item));
  }
  return el;
}

function makeMatchChip(match) {
  const el = document.createElement('div');
  el.className = 'match-chip';
  el.style.borderColor = match.color + '40';

  const badge = document.createElement('span');
  badge.className = 'match-chip-badge';
  badge.style.background = match.color;
  badge.textContent = match.number;

  const names = document.createElement('div');
  names.className = 'match-chip-names';

  const subName = document.createElement('span');
  subName.className = 'match-chip-subtitle';
  subName.textContent = match.subtitle.name;
  subName.title = match.subtitle.name;

  const arrow = document.createElement('span');
  arrow.className = 'match-chip-arrow';
  arrow.textContent = '→';

  const vidName = document.createElement('span');
  vidName.className = 'match-chip-video';
  vidName.textContent = match.video.name;
  vidName.title = match.video.name;

  names.appendChild(subName);
  names.appendChild(arrow);
  names.appendChild(vidName);

  const unBtn = document.createElement('button');
  unBtn.className = 'unmatch-btn';
  unBtn.title = 'Remove this match';
  unBtn.textContent = '✕';
  unBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeMatch(match.id);
  });

  el.appendChild(badge);
  el.appendChild(names);
  el.appendChild(unBtn);
  return el;
}

// Results Modal
function showResultsModal(results, type, exportData = null) {
  dom.modalResults.innerHTML = '';
  dom.modalActions.innerHTML = '';

  results.forEach(r => {
    const row = document.createElement('div');
    row.className = 'result-row ' + (r.success ? 'success' : 'failure');

    const icon = document.createElement('span');
    icon.className = 'result-icon';
    icon.textContent = r.success ? '✅' : '❌';

    const text = document.createElement('div');
    text.className = 'result-text';

    const label = document.createElement('div');
    label.className = 'result-label';
    label.textContent = r.success
      ? (type === 'fs' ? `Renamed on disk: ${r.newName}` : `Prepared for download: ${r.newName}`)
      : `Failed: ${r.oldName}`;

    text.appendChild(label);
    if (!r.success && r.error) {
      const err = document.createElement('div');
      err.className = 'result-error';
      err.textContent = r.error;
      text.appendChild(err);
    }

    row.appendChild(icon);
    row.appendChild(text);
    dom.modalResults.appendChild(row);
  });

  if (type === 'download' && exportData) {
    if (exportData.zip) {
      const zipBtn = document.createElement('button');
      zipBtn.className = 'done-btn download-zip-btn';
      zipBtn.innerHTML = '📦 Download All as ZIP';
      zipBtn.addEventListener('click', () => {
        exportData.zip.generateAsync({ type: 'blob' }).then(blob => {
          triggerDownload(blob, 'renamed_subtitles.zip');
        });
      });
      dom.modalActions.appendChild(zipBtn);
    }
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'done-btn';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', closeModal);
  dom.modalActions.appendChild(closeBtn);

  dom.modal.classList.remove('hidden');
}

function closeModal() {
  dom.modal.classList.add('hidden');
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// UI Helpers
function updateDoneButton() {
  dom.doneBtn.disabled = state.matches.length === 0;
}

function updateModeLabel(htmlText) {
  dom.modeInfo.innerHTML = `<span class="mode-tag">Active</span> ` + htmlText;
}

function showLoading(text = 'Processing…') {
  dom.loadingText.textContent = text;
  dom.loading.classList.remove('hidden');
}

function hideLoading() {
  dom.loading.classList.add('hidden');
}

let toastTimer = null;
function showToast(msg, type = 'info') {
  clearTimeout(toastTimer);
  dom.toast.textContent = msg;
  dom.toast.className = 'toast' + (type === 'error' ? ' error-toast' : type === 'success' ? ' success-toast' : type === 'warning' ? ' warning-toast' : '');
  toastTimer = setTimeout(() => {
    dom.toast.classList.add('fading');
    setTimeout(() => { dom.toast.className = 'toast hidden'; }, 300);
  }, 3200);
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Drag & Drop Traversal
['dragenter', 'dragover'].forEach(eventName => {
  window.addEventListener(eventName, e => {
    e.preventDefault();
    dom.dragOverlay.classList.remove('hidden');
  });
});

['dragleave', 'drop'].forEach(eventName => {
  window.addEventListener(eventName, e => {
    e.preventDefault();
    if (e.target === dom.dragOverlay || eventName === 'drop') {
      dom.dragOverlay.classList.add('hidden');
    }
  });
});

window.addEventListener('drop', async e => {
  e.preventDefault();
  dom.dragOverlay.classList.add('hidden');

  const items = e.dataTransfer.items;
  if (!items || items.length === 0) return;

  showLoading('Scanning dropped folder tree…');
  const filesList = [];
  const entries = [];

  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
  }

  if (entries.length > 0) {
    for (const entry of entries) {
      await traverseFileTree(entry, '', filesList);
    }
    processFileList(filesList, 'Dropped Folder');
  } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    processFileList(e.dataTransfer.files, 'Dropped Files');
  } else {
    hideLoading();
  }
});

async function traverseFileTree(item, path, fileList) {
  path = path || '';
  if (item.isFile) {
    await new Promise(resolve => {
      item.file(file => {
        try {
          Object.defineProperty(file, 'webkitRelativePath', {
            value: path ? path + file.name : file.name
          });
        } catch (_) {}
        fileList.push(file);
        resolve();
      });
    });
  } else if (item.isDirectory) {
    const dirReader = item.createReader();
    const entries = await new Promise(resolve => {
      dirReader.readEntries(res => resolve(res));
    });
    for (const childEntry of entries) {
      await traverseFileTree(childEntry, path + item.name + '/', fileList);
    }
  }
}

// Event Listeners
dom.selectFolderBtn.addEventListener('click', openDirectoryPicker);

dom.uploadFolderInput.addEventListener('change', e => {
  if (e.target.files && e.target.files.length > 0) {
    processFileList(e.target.files, 'Uploaded Folder');
  }
});

if (dom.selectDestFolderBtn) {
  dom.selectDestFolderBtn.addEventListener('click', openDestDirectoryPicker);
}
if (dom.clearDestBtn) {
  dom.clearDestBtn.addEventListener('click', clearDestinationFolder);
}
if (dom.destBrowseDiskBtn) {
  dom.destBrowseDiskBtn.addEventListener('click', async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        setDestinationFolder(handle, handle.name);
        showToast(`🎯 Destination set to: ${handle.name}`, 'success');
        closeDestModal();
      } catch (err) {
        if (err.name !== 'AbortError') {
          showToast('Could not open destination folder: ' + err.message, 'warning');
        }
      }
    } else {
      showToast('Disk folder picker is not supported on this browser', 'warning');
    }
  });
}
if (dom.destSaveBtn) {
  dom.destSaveBtn.addEventListener('click', saveDestModalInput);
}
if (dom.destCancelBtn) {
  dom.destCancelBtn.addEventListener('click', closeDestModal);
}
if (dom.destModalBackdrop) {
  dom.destModalBackdrop.addEventListener('click', closeDestModal);
}

if (dom.toggleSidebarBtn) {
  dom.toggleSidebarBtn.addEventListener('click', () => toggleSidebar());
}
if (dom.floatingSidebarBtn) {
  dom.floatingSidebarBtn.addEventListener('click', () => toggleSidebar(false));
}

dom.autoMatchBtn.addEventListener('click', autoMatch);
dom.doneBtn.addEventListener('click', applyMatches);
dom.clearBtn.addEventListener('click', () => {
  if (state.matches.length === 0) return;
  clearAllMatches();
  showToast('All matches cleared');
});

if (dom.historyBtn) {
  dom.historyBtn.addEventListener('click', openHistoryModal);
}
if (dom.historyCloseBtn) {
  dom.historyCloseBtn.addEventListener('click', closeHistoryModal);
}
if (dom.historyModalBackdrop) {
  dom.historyModalBackdrop.addEventListener('click', closeHistoryModal);
}
if (dom.historySearchInput) {
  dom.historySearchInput.addEventListener('input', e => renderHistoryList(e.target.value));
}
if (dom.exportHistoryBtn) {
  dom.exportHistoryBtn.addEventListener('click', exportHistoryLog);
}
if (dom.clearHistoryBtn) {
  dom.clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all history records?')) {
      clearAllHistory();
    }
  });
}
if (dom.editHistorySaveBtn) {
  dom.editHistorySaveBtn.addEventListener('click', saveEditHistoryModal);
}
if (dom.editHistoryCancelBtn) {
  dom.editHistoryCancelBtn.addEventListener('click', closeEditHistoryModal);
}
if (dom.editHistoryBackdrop) {
  dom.editHistoryBackdrop.addEventListener('click', closeEditHistoryModal);
}

dom.modalClose.addEventListener('click', async () => {
  closeModal();
  await executeMoveOperations();
});
if (dom.modalCancel) {
  dom.modalCancel.addEventListener('click', closeModal);
}
dom.modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeDestModal();
    closeHistoryModal();
    closeEditHistoryModal();
  }
});

// Initialize history badge count on startup
updateHistoryBadge();
