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
   git clone https://github.com/ahmedhanysharaf-creator/Subtitle-Matcher.git
   cd Subtitle-Matcher
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
   http://localhost:3000   (or http://10.152.204.132:3000 over LAN)
   ```

---

## 🧭 How to Use

1. **Set Source Folder** — the folder containing your subtitle and video files
2. **Set Destination Folder** — optional target folder where you want the renamed files to be moved
3. **Auto Match / Manual Match** — click **✨ Auto Match** to pair by episode number automatically, or select a subtitle then its matching film
4. **Click Apply Matches** — subtitles are renamed to match the video filenames instantly!

---

## 📁 Supported Formats

| Type | Extensions |
|------|-----------|
| Subtitles | `.srt`, `.ass`, `.vtt`, `.sub`, `.ssa`, `.sbv`, `.idx` |
| Videos | `.mp4`, `.mkv`, `.avi`, `.mov`, `.wmv`, `.m4v`, `.webm`, `.flv`, `.ts`, `.m2ts`, `.ogv`, `.divx` |

---

## 🛑 Stopping the App

Press `Ctrl + C` in the terminal window where the app is running.
