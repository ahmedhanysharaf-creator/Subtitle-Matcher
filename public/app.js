/* ═══════════════════════════════════════════
   SUBTITLE MATCHER — Frontend Logic
   ═══════════════════════════════════════════ */

'use strict';

// ─────────────────────────────────────────────────────────
// Badge colour palette — each matched pair gets one colour
// ─────────────────────────────────────────────────────────
const BADGE_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f59e0b', '#a855f7', '#84cc16',
];

// ─────────────────────────────────────────────────────────
// App State
// ─────────────────────────────────────────────────────────
const state = {
  rootPath:    '',      // the folder first loaded by the user
  currentPath: '',      // folder currently in view
  subfolders:  [],
  subtitles:   [],
  videos:      [],
  matches:     [],      // [{id, subtitle, video, number, color, isInSubfolder}]
  pendingItem: null,    // {type:'subtitle'|'video', item:{name,path,...}}
  matchCounter: 0,
};

// ─────────────────────────────────────────────────────────
// DOM References
// ─────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const dom = {
  sourcePath:    $('source-path'),
  destPath:      $('dest-path'),
  browseSource:  $('browse-source-btn'),
  browseDest:    $('browse-dest-btn'),
  loadBtn:       $('load-btn'),
  doneBtn:       $('done-btn'),
  breadcrumb:    $('breadcrumb'),
  subtitleList:  $('subtitle-list'),
  videoList:     $('video-list'),
  subCount:      $('sub-count'),
  vidCount:      $('vid-count'),
  matchesList:   $('matches-list'),
  matchCount:    $('match-count'),
  clearBtn:      $('clear-matches-btn'),
  modal:         $('results-modal'),
  modalResults:  $('modal-results'),
  modalClose:    $('modal-close-btn'),
  modalBackdrop: $('modal-backdrop'),
  toast:         $('toast'),
  loading:       $('loading-overlay'),
  loadingText:   $('loading-text'),
  autoMatchBtn:  $('auto-match-btn'),
};

// ─────────────────────────────────────────────────────────
// API Helpers
// ─────────────────────────────────────────────────────────
async function apiBrowse(folderPath) {
  const res = await fetch('/api/browse?path=' + encodeURIComponent(folderPath));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to browse folder');
  return data;
}

async function apiOpenDialog() {
  showLoading('Opening folder picker…');
  try {
    const res = await fetch('/api/open-dialog');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Dialog failed');
    return data;
  } finally {
    hideLoading();
  }
}

async function apiRename(pairs, destinationFolder) {
  const res = await fetch('/api/rename', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ pairs, destinationFolder }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Rename failed');
  return data;
}

// ─────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────
async function loadFolder(folderPath, isRoot = false) {
  showLoading('Loading folder…');
  try {
    const data = await apiBrowse(folderPath);
    if (isRoot) state.rootPath = folderPath;
    state.currentPath  = data.path;
    state.subfolders   = data.subfolders;
    state.subtitles    = data.subtitles;
    state.videos       = data.videos;
    state.pendingItem  = null;

    renderAll();
    renderBreadcrumb();
  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function getParentPath(p) {
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(sep).filter(Boolean);
  if (parts.length <= 1) return null;
  parts.pop();
  const parent = parts.join(sep);
  // Windows drive root like "C:"
  if (/^[A-Za-z]:$/.test(parent)) return parent + '\\';
  return (sep === '/' ? '/' : '') + parent;
}

// ─────────────────────────────────────────────────────────
// Matching Logic
// ─────────────────────────────────────────────────────────
function getMatchForItem(type, item) {
  return state.matches.find(m =>
    type === 'subtitle'
      ? m.subtitle.path === item.path
      : m.video.path   === item.path
  ) || null;
}

function isPending(type, item) {
  return !!state.pendingItem &&
    state.pendingItem.type === type &&
    state.pendingItem.item.path === item.path;
}

function handleItemClick(type, item) {
  // Ignore already-matched items
  if (getMatchForItem(type, item)) return;

  const pending = state.pendingItem;

  if (!pending) {
    state.pendingItem = { type, item };
    renderAll();
    return;
  }

  if (pending.type === type) {
    // Same type: switch selection, or deselect if clicking same item
    state.pendingItem = pending.item.path === item.path ? null : { type, item };
    renderAll();
    return;
  }

  // Opposite type — create a match!
  const subtitle = type === 'subtitle' ? item : pending.item;
  const video    = type === 'video'    ? item : pending.item;

  state.matchCounter++;
  const color = BADGE_COLORS[(state.matchCounter - 1) % BADGE_COLORS.length];

  state.matches.push({
    id:           Date.now() + Math.random(),
    subtitle,
    video,
    number:       state.matchCounter,
    color,
    isInSubfolder: state.currentPath !== state.rootPath,
  });

  state.pendingItem = null;
  renderAll();
  updateDoneButton();
}

function removeMatch(matchId) {
  const idx = state.matches.findIndex(m => m.id === matchId);
  if (idx === -1) return;
  state.matches.splice(idx, 1);
  // Re-number remaining matches and re-assign colours
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

function extractEpisodeKey(filename) {
  const cleanName = filename.toLowerCase();

  // Pattern 1: S01E05 or s1e5 or 1x05
  const sEpMatch = cleanName.match(/s(\d+)\s*e(\d+)|(\d+)x(\d+)/i);
  if (sEpMatch) {
    const season = parseInt(sEpMatch[1] || sEpMatch[3], 10);
    const episode = parseInt(sEpMatch[2] || sEpMatch[4], 10);
    return `S${season}E${episode}`;
  }

  // Pattern 2: E05 or Ep 05 or Episode 05
  const epMatch = cleanName.match(/(?:ep|episode|e)[._\s-]*(\d+)/i);
  if (epMatch) {
    const episode = parseInt(epMatch[1], 10);
    return `E${episode}`;
  }

  // Pattern 3: Standalone numbers like "05" or "5"
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

  // 1. Match by extracted episode/season keys
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
        isInSubfolder: state.currentPath !== state.rootPath,
      });
      matchedCount++;
    } else {
      remainingSubs.push(sub);
    }
  });

  // 2. Index-based 1:1 fallback if counts match exactly and no key matches were found
  const remainingVids = unmatchedVids.filter(v => !state.matches.some(m => m.video.path === v.path));
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
        isInSubfolder: state.currentPath !== state.rootPath,
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
// Apply (Done)
// ─────────────────────────────────────────────────────────
async function applyMatches() {
  if (state.matches.length === 0) return;

  const destinationFolder = dom.destPath.value.trim();

  const pairs = state.matches.map(m => ({
    subtitlePath:  m.subtitle.path,
    videoPath:     m.video.path,
    isInSubfolder: m.isInSubfolder,
  }));

  showLoading('Renaming files…');
  try {
    const { results } = await apiRename(pairs, destinationFolder);
    hideLoading();
    showResultsModal(results, state.matches);

    // Remove successful matches from state
    const failedPaths = new Set(
      results.filter(r => !r.success).map(r => r.subtitlePath)
    );
    state.matches = state.matches.filter(m => failedPaths.has(m.subtitle.path));
    state.matchCounter = state.matches.length;

    // Re-number remaining (failed) matches
    state.matches.forEach((m, i) => {
      m.number = i + 1;
      m.color  = BADGE_COLORS[i % BADGE_COLORS.length];
    });

    // Reload folder to reflect renames
    if (state.currentPath) await loadFolder(state.currentPath);
    else renderAll();

    updateDoneButton();
  } catch (err) {
    hideLoading();
    showToast('❌ ' + err.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────
function renderAll() {
  renderSubtitleList();
  renderVideoList();
  renderMatchesList();
}

function renderSubtitleList() {
  const container = dom.subtitleList;
  container.innerHTML = '';

  const matchedCount = state.subtitles.filter(s => getMatchForItem('subtitle', s)).length;
  dom.subCount.textContent = `${state.subtitles.length} file${state.subtitles.length !== 1 ? 's' : ''}, ${matchedCount} matched`;

  if (state.subfolders.length > 0) {
    container.appendChild(makeSectionLabel('Subfolders'));
    state.subfolders.forEach(f => container.appendChild(makeFolderItem(f)));
  }

  if (state.subtitles.length === 0 && state.subfolders.length === 0) {
    container.appendChild(makeEmptyState('No .srt files found here'));
    return;
  }

  if (state.subtitles.length === 0) {
    container.appendChild(makeEmptyState('No .srt files in this folder'));
    return;
  }

  if (state.subfolders.length > 0) {
    container.appendChild(makeSectionLabel('Subtitle Files'));
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

  if (state.subfolders.length > 0) {
    container.appendChild(makeSectionLabel('Subfolders'));
    state.subfolders.forEach(f => container.appendChild(makeFolderItem(f)));
  }

  if (state.videos.length === 0 && state.subfolders.length === 0) {
    container.appendChild(makeEmptyState('No video files found here'));
    return;
  }

  if (state.videos.length === 0) {
    container.appendChild(makeEmptyState('No video files in this folder'));
    return;
  }

  if (state.subfolders.length > 0) {
    container.appendChild(makeSectionLabel('Video Files'));
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
    msg.textContent = 'No matches yet — select a subtitle then a film to pair them.';
    container.appendChild(msg);
    return;
  }

  state.matches.forEach(match => container.appendChild(makeMatchChip(match)));
}

// ─── DOM Builders ───────────────────────────────────────

function makeSectionLabel(text) {
  const el = document.createElement('div');
  el.className = 'folder-section-sep';
  el.textContent = text;
  return el;
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

function makeFolderItem(folder) {
  const el = document.createElement('div');
  el.className = 'list-item folder-item';

  const icon = document.createElement('span');
  icon.className = 'item-icon';
  icon.textContent = '📁';

  const name = document.createElement('span');
  name.className = 'item-name';
  name.textContent = folder.name;
  name.title = folder.name;

  const arrow = document.createElement('span');
  arrow.className = 'folder-arrow';
  arrow.textContent = '→';

  el.appendChild(icon);
  el.appendChild(name);
  el.appendChild(arrow);
  el.addEventListener('click', () => loadFolder(folder.path));
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

  if (match.isInSubfolder) {
    const tag = document.createElement('span');
    tag.className = 'subfolder-tag';
    tag.textContent = 'subfolder';
    names.appendChild(tag);
  }

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
// Breadcrumb
// ─────────────────────────────────────────────────────────
function renderBreadcrumb() {
  dom.breadcrumb.innerHTML = '';

  if (!state.currentPath) return;

  const sep = state.currentPath.includes('\\') ? '\\' : '/';
  const parts = state.currentPath.split(sep).filter(Boolean);

  // Back button (only when inside a subfolder)
  if (state.currentPath !== state.rootPath) {
    const backBtn = document.createElement('button');
    backBtn.className = 'bc-back-btn';
    backBtn.innerHTML = '← Back';
    backBtn.title = 'Go to parent folder';
    backBtn.addEventListener('click', () => {
      const parent = getParentPath(state.currentPath);
      if (parent) loadFolder(parent);
    });
    dom.breadcrumb.appendChild(backBtn);
  }

  // Build path parts
  let builtPath = '';
  parts.forEach((part, idx) => {
    // Reconstruct path up to this part
    if (idx === 0 && /^[A-Za-z]:$/.test(part)) {
      builtPath = part + '\\';
    } else {
      builtPath = builtPath
        ? (builtPath.endsWith(sep) ? builtPath + part : builtPath + sep + part)
        : part;
    }

    if (idx > 0) {
      const s = document.createElement('span');
      s.className = 'bc-sep';
      s.textContent = '›';
      dom.breadcrumb.appendChild(s);
    }

    const isCurrent = idx === parts.length - 1;
    const el = document.createElement('span');
    el.className = 'bc-part' + (isCurrent ? ' current' : '');
    el.textContent = part;
    el.title = builtPath;

    if (!isCurrent) {
      const pathSnap = builtPath;
      el.addEventListener('click', () => loadFolder(pathSnap));
    }

    dom.breadcrumb.appendChild(el);
  });

  // "Root" label if we're in a subfolder
  if (state.currentPath !== state.rootPath) {
    const rootLabel = document.createElement('span');
    rootLabel.className = 'bc-root-label';
    rootLabel.textContent = '(root: ' + getLastPart(state.rootPath) + ')';
    dom.breadcrumb.appendChild(rootLabel);
  }
}

function getLastPart(p) {
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(sep).filter(Boolean);
  return parts[parts.length - 1] || p;
}

// ─────────────────────────────────────────────────────────
// Results Modal
// ─────────────────────────────────────────────────────────
function showResultsModal(results, matches) {
  dom.modalResults.innerHTML = '';

  results.forEach((r, i) => {
    const match = matches[i];
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
      ? `Subtitle renamed: ${r.newFileName}`
      : `Failed: ${match ? match.subtitle.name : r.subtitlePath}`;

    text.appendChild(label);

    if (r.success && r.newSubtitlePath) {
      const detail = document.createElement('div');
      detail.className = 'result-detail';
      detail.textContent = '📄 Subtitle → ' + r.newSubtitlePath;
      text.appendChild(detail);
    }

    if (r.success && r.newVideoPath) {
      const videoDetail = document.createElement('div');
      videoDetail.className = 'result-detail';
      videoDetail.textContent = '🎬 Movie → ' + r.newVideoPath;
      text.appendChild(videoDetail);
    }

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

  dom.modal.classList.remove('hidden');
}

function closeModal() {
  dom.modal.classList.add('hidden');
}

// ─────────────────────────────────────────────────────────
// UI Helpers
// ─────────────────────────────────────────────────────────
function updateDoneButton() {
  dom.doneBtn.disabled = state.matches.length === 0;
}

function showLoading(text = 'Loading…') {
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
  dom.toast.className = 'toast' + (type === 'error' ? ' error-toast' : type === 'success' ? ' success-toast' : '');
  toastTimer = setTimeout(() => {
    dom.toast.classList.add('fading');
    setTimeout(() => { dom.toast.className = 'toast hidden'; }, 300);
  }, 3200);
}

// ─────────────────────────────────────────────────────────
// Event Listeners
// ─────────────────────────────────────────────────────────

// Load button / Enter key on source input
dom.loadBtn.addEventListener('click', () => {
  const p = dom.sourcePath.value.trim();
  if (!p) { showToast('Please enter a folder path', 'error'); return; }
  loadFolder(p, true);
});

dom.sourcePath.addEventListener('keydown', e => {
  if (e.key === 'Enter') dom.loadBtn.click();
});

// Browse source folder
dom.browseSource.addEventListener('click', async () => {
  const result = await apiOpenDialog();
  if (!result.cancelled && result.path) {
    dom.sourcePath.value = result.path;
    loadFolder(result.path, true);
  }
});

// Browse destination folder
dom.browseDest.addEventListener('click', async () => {
  const result = await apiOpenDialog();
  if (!result.cancelled && result.path) {
    dom.destPath.value = result.path;
    showToast('✅ Destination folder set', 'success');
  }
});

// Done button
dom.doneBtn.addEventListener('click', applyMatches);

// Auto Match button
if (dom.autoMatchBtn) {
  dom.autoMatchBtn.addEventListener('click', autoMatch);
}

// Clear all matches
dom.clearBtn.addEventListener('click', () => {
  if (state.matches.length === 0) return;
  clearAllMatches();
  showToast('All matches cleared');
});

// Modal close
dom.modalClose.addEventListener('click', closeModal);
dom.modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
