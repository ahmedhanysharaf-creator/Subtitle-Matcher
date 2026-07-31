const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.webm', '.flv', '.ts', '.m2ts', '.ogv', '.divx', '.3gp', '.mpg', '.mpeg'];
const SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.vtt', '.sub', '.ssa', '.sbv', '.idx'];

// ─────────────────────────────────────────────────────────
// Browse a folder
// ─────────────────────────────────────────────────────────
app.get('/api/browse', (req, res) => {
  const folderPath = req.query.path;
  if (!folderPath) return res.status(400).json({ error: 'No path provided' });

  try {
    if (!fs.existsSync(folderPath)) {
      return res.status(404).json({ error: 'Folder not found: ' + folderPath });
    }
    const stat = fs.statSync(folderPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const subfolders = [];
    const subtitles = [];
    const videos = [];

    for (const entry of entries) {
      try {
        const fullPath = path.join(folderPath, entry.name);
        if (entry.isDirectory()) {
          subfolders.push({ name: entry.name, type: 'folder', path: fullPath });
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUBTITLE_EXTENSIONS.includes(ext)) {
            subtitles.push({ name: entry.name, type: 'subtitle', path: fullPath });
          } else if (VIDEO_EXTENSIONS.includes(ext)) {
            videos.push({ name: entry.name, type: 'video', path: fullPath });
          }
        }
      } catch (_) { /* skip inaccessible entries */ }
    }

    // Natural sort
    const naturalSort = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    subfolders.sort(naturalSort);
    subtitles.sort(naturalSort);
    videos.sort(naturalSort);

    res.json({ path: folderPath, subfolders, subtitles, videos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// Open native folder picker dialog (Windows PowerShell)
// ─────────────────────────────────────────────────────────
app.get('/api/open-dialog', (req, res) => {
  const tmpScript = path.join(os.tmpdir(), 'subtitle_matcher_dialog.ps1');
  const psScript = `
[System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select Subtitle / Video Folder"
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.SelectedPath
}
`;

  try {
    fs.writeFileSync(tmpScript, psScript, 'utf8');
  } catch (err) {
    return res.status(500).json({ error: 'Cannot write temp script: ' + err.message });
  }

  exec(`powershell -Sta -ExecutionPolicy Bypass -File "${tmpScript}"`, { timeout: 120000 }, (err, stdout, stderr) => {
    try { fs.unlinkSync(tmpScript); } catch (_) {}
    if (err) return res.status(500).json({ error: err.message || 'Folder dialog failed or timed out' });
    const selectedPath = stdout.trim();
    if (!selectedPath) return res.json({ cancelled: true });
    res.json({ path: selectedPath });
  });
});

// ─────────────────────────────────────────────────────────
// Rename & move matched subtitle files
// ─────────────────────────────────────────────────────────
app.post('/api/rename', (req, res) => {
  const { pairs, destinationFolder } = req.body;
  if (!Array.isArray(pairs)) return res.status(400).json({ error: 'pairs must be an array' });

  const results = [];

  for (const pair of pairs) {
    const { subtitlePath, videoPath } = pair;
    try {
      if (!fs.existsSync(subtitlePath)) {
        results.push({ success: false, subtitlePath, error: 'Subtitle file not found' });
        continue;
      }

      const videoBaseName = path.basename(videoPath, path.extname(videoPath));
      const videoExt = path.extname(videoPath);
      const subtitleExt = path.extname(subtitlePath);
      const newSubtitleFileName = videoBaseName + subtitleExt;
      const subtitleDir = path.dirname(subtitlePath);

      let newSubtitlePath;
      let newVideoPath = null;

      if (destinationFolder && destinationFolder.trim()) {
        const targetDest = destinationFolder.trim();
        if (!fs.existsSync(targetDest)) {
          fs.mkdirSync(targetDest, { recursive: true });
        }
        newSubtitlePath = path.join(targetDest, newSubtitleFileName);
        newVideoPath = path.join(targetDest, videoBaseName + videoExt);
      } else {
        newSubtitlePath = path.join(subtitleDir, newSubtitleFileName);
      }

      // Safe rename for subtitle (only rename/move if path changes)
      if (path.resolve(subtitlePath) !== path.resolve(newSubtitlePath)) {
        try {
          fs.renameSync(subtitlePath, newSubtitlePath);
        } catch (renameErr) {
          if (renameErr.code === 'EXDEV') {
            fs.copyFileSync(subtitlePath, newSubtitlePath);
            fs.unlinkSync(subtitlePath);
          } else {
            throw renameErr;
          }
        }
      }

      // Move video file to destination if requested and path changes
      if (newVideoPath && fs.existsSync(videoPath) && path.resolve(videoPath) !== path.resolve(newVideoPath)) {
        try {
          fs.renameSync(videoPath, newVideoPath);
        } catch (renameErr) {
          if (renameErr.code === 'EXDEV') {
            fs.copyFileSync(videoPath, newVideoPath);
            fs.unlinkSync(videoPath);
          } else {
            throw renameErr;
          }
        }
      }

      results.push({
        success: true,
        subtitlePath,
        newSubtitlePath,
        newFileName: newSubtitleFileName,
        videoPath,
        newVideoPath,
      });
    } catch (err) {
      results.push({ success: false, subtitlePath, error: err.message });
    }
  }

  res.json({ results });
});

// ─────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────
const PORT = 3000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log('\n🎬 Subtitle Matcher is running!');
  console.log(`   Local access:   http://localhost:${PORT}`);
  console.log(`   Network access: http://10.152.204.132:${PORT}\n`);
});

