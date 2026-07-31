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
  subfolders: [], // [{ name, handle, path }]
  subtitles: [],  // [{ name, ext, file, handle, path }]
  videos: [],     // [{ name, ext, file, handle, path }]
  allUploadFiles: [], // For upload mode subfolder filtering
  currentSubfolderFilter: null,
  matches: [],    // [{ id, subtitle, video, number, color }]
  pendingItem: null,
  matchCounter: 0,
  sidebarCollapsed: false,
};

// DOM References
const $ = id => document.getElementById(id);
const dom = {
  selectFolderBtn:   $('select-folder-btn'),
  uploadFolderInput: $('upload-folder-input'),
  autoMatchBtn:      $('auto-match-btn'),
  doneBtn:           $('done-btn'),
  modeInfo:          $('mode-info'),
  currentFolderLabel:$('current-folder-label'),
  mainPanels:        $('main-panels'),
  dragOverlay:       $('drag-overlay'),
  subfoldersPanel:   $('subfolders-panel'),
  subfoldersList:    $('subfolders-list'),
  folderCount:       $('folder-count'),
  toggleSidebarBtn:  $('toggle-sidebar-btn'),
  floatingSidebarBtn:$('floating-sidebar-btn'),
  subfolderDivider:  $('subfolder-divider'),
  subtitleList:      $('subtitle-list'),
  videoList:         $('video-list'),
  subCount:          $('sub-count'),
  vidCount:          $('vid-count'),
  matchesList:       $('matches-list'),
  matchCount:        $('match-count'),
  clearBtn:          $('clear-matches-btn'),
  modal:             $('results-modal'),
  modalResults:      $('modal-results'),
  modalActions:      $('modal-actions'),
  modalClose:        $('modal-close-btn'),
  modalBackdrop:     $('modal-backdrop'),
  toast:             $('toast'),
  loading:           $('loading-overlay'),
  loadingText:       $('loading-text'),
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
      if (entry.kind === 'directory') {
        state.subfolders.push({ name: entry.name, handle: entry, path: entry.name });
      } else if (entry.kind === 'file') {
        const ext = getFileExt(entry.name);
        if (SUBTITLE_EXTENSIONS.includes(ext)) {
          state.subtitles.push({ name: entry.name, ext, handle: entry, path: entry.name });
        } else if (VIDEO_EXTENSIONS.includes(ext)) {
          state.videos.push({ name: entry.name, ext, handle: entry, path: entry.name });
        }
      }
    }

    state.subfolders.sort(naturalSort);
    state.subtitles.sort(naturalSort);
    state.videos.sort(naturalSort);

    updateModeLabel(`Local Disk Folder: <strong>${escapeHtml(handle.name)}</strong> (${state.subfolders.length} subfolders)`);
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

  const subfolderNames = new Set();

  state.allUploadFiles.forEach(file => {
    const relPath = file.webkitRelativePath || file.name;
    const parts = relPath.split('/').filter(Boolean);

    if (parts.length > 1) {
      subfolderNames.add(parts[0]);
    }

    const ext = getFileExt(file.name);
    if (SUBTITLE_EXTENSIONS.includes(ext)) {
      state.subtitles.push({ name: file.name, ext, file, path: relPath });
    } else if (VIDEO_EXTENSIONS.includes(ext)) {
      state.videos.push({ name: file.name, ext, file, path: relPath });
    }
  });

  state.subfolders = Array.from(subfolderNames).map(name => ({ name, path: name }));
  state.subfolders.sort(naturalSort);
  state.subtitles.sort(naturalSort);
  state.videos.sort(naturalSort);

  updateModeLabel(`Uploaded Mode: <strong>${escapeHtml(folderName)}</strong> (${state.subfolders.length} subfolders)`);
  renderAll();
  updateDoneButton();
  hideLoading();
  showToast(`Loaded ${state.subtitles.length} subtitles & ${state.videos.length} films`, 'success');
}

function filterUploadSubfolder(subfolderName) {
  state.currentSubfolderFilter = subfolderName;
  showLoading(`Loading ${subfolderName}…`);

  const filteredSubs = [];
  const filteredVids = [];

  state.allUploadFiles.forEach(file => {
    const relPath = file.webkitRelativePath || file.name;
    const parts = relPath.split('/').filter(Boolean);

    if (parts.length > 1 && parts[0] === subfolderName) {
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

  updateModeLabel(`Subfolder: <strong>${escapeHtml(subfolderName)}</strong> (${state.subtitles.length} subtitles, ${state.videos.length} films)`);
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
// Apply Matches & Renaming Execution
// ─────────────────────────────────────────────────────────
async function applyMatches() {
  if (state.matches.length === 0) return;

  showLoading('Processing matches…');
  const results = [];

  try {
    if (state.mode === 'fs' && state.dirHandle) {
      for (const match of state.matches) {
        const videoBase = getBaseName(match.video.name);
        const subExt = match.subtitle.ext;
        const newFileName = videoBase + subExt;

        try {
          if (match.subtitle.name === newFileName) {
            results.push({ success: true, oldName: match.subtitle.name, newName: newFileName, note: 'Already matching' });
            continue;
          }

          if ('move' in match.subtitle.handle) {
            await match.subtitle.handle.move(newFileName);
          } else {
            const file = await match.subtitle.handle.getFile();
            const content = await file.arrayBuffer();
            const newHandle = await state.dirHandle.getFileHandle(newFileName, { create: true });
            const writable = await newHandle.createWritable();
            await writable.write(content);
            await writable.close();
            try { await state.dirHandle.removeEntry(match.subtitle.name); } catch (_) {}
          }

          results.push({ success: true, oldName: match.subtitle.name, newName: newFileName });
        } catch (err) {
          results.push({ success: false, oldName: match.subtitle.name, error: err.message });
        }
      }

      hideLoading();
      showResultsModal(results, 'fs');
    } else {
      const zip = typeof JSZip !== 'undefined' ? new JSZip() : null;
      const downloadItems = [];

      for (const match of state.matches) {
        const videoBase = getBaseName(match.video.name);
        const subExt = match.subtitle.ext;
        const newFileName = videoBase + subExt;

        try {
          let fileObj = match.subtitle.file;
          if (!fileObj && match.subtitle.handle) {
            fileObj = await match.subtitle.handle.getFile();
          }

          if (fileObj) {
            if (zip) {
              zip.file(newFileName, fileObj);
            }
            downloadItems.push({ file: fileObj, newName: newFileName });
            results.push({ success: true, oldName: match.subtitle.name, newName: newFileName });
          } else {
            throw new Error('File data unavailable');
          }
        } catch (err) {
          results.push({ success: false, oldName: match.subtitle.name, error: err.message });
        }
      }

      hideLoading();
      showResultsModal(results, 'download', { zip, downloadItems });
    }
  } catch (err) {
    hideLoading();
    showToast('❌ Execution failed: ' + err.message, 'error');
  }
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

// ─────────────────────────────────────────────────────────
// Results Modal
// ─────────────────────────────────────────────────────────
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

// Drag & Drop
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

window.addEventListener('drop', e => {
  e.preventDefault();
  if (e.dataTransfer && e.dataTransfer.files.length > 0) {
    processFileList(e.dataTransfer.files, 'Dropped Files');
  }
});

// Event Listeners
dom.selectFolderBtn.addEventListener('click', openDirectoryPicker);

dom.uploadFolderInput.addEventListener('change', e => {
  if (e.target.files && e.target.files.length > 0) {
    processFileList(e.target.files, 'Uploaded Folder');
  }
});

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

dom.modalClose.addEventListener('click', closeModal);
dom.modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
