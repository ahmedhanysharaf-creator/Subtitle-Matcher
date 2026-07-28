# 🎬 Subtitle Matcher

A local web app to manually match subtitle files (`.srt`) to their movies, rename the subtitles to match, and move both the movie and subtitle to a destination folder — all from a clean browser interface.

---

## ✅ Requirements

- [Node.js](https://nodejs.org/) (v18 or higher) — **must be installed first**
- Windows (uses PowerShell for the folder picker dialog)

---

## 🚀 How to Run

1. **Download or clone this project**
   ```
   git clone https://github.com/YOUR_USERNAME/subtitle-matcher.git
   cd subtitle-matcher
   ```

2. **Install dependencies** (only needed once)
   ```
   npm install
   ```

3. **Start the app**
   ```
   npm start
   ```

4. **Open your browser** and go to:
   ```
   http://localhost:3000
   ```

---

## 🧭 How to Use

1. **Set Source Folder** — the folder containing your subtitle (`.srt`) and video files
2. **Set Destination Folder** — where you want the renamed files to end up
3. **Match pairs** — click a subtitle, then click its matching movie (they get colour-coded)
4. Click **Done** — the subtitles are renamed and **both the subtitle and movie** are moved to the destination folder

---

## 📁 Supported Formats

| Type | Extensions |
|------|-----------|
| Subtitles | `.srt` |
| Videos | `.mp4`, `.mkv`, `.avi`, `.mov`, `.wmv`, `.m4v` |

---

## 🛑 Stopping the App

Press `Ctrl + C` in the terminal window where the app is running.
