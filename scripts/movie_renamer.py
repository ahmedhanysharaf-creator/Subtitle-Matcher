#!/usr/bin/env python3
"""
movie_renamer.py  v1.2.0
========================
Intelligent Movie Renaming Tool — Powered by TMDb

HOW TO USE
----------
1. Open PowerShell inside your films folder:
       cd "D:/Films"
2. Run:
       python movie_renamer.py
   or specify a folder:
       python movie_renamer.py --folder "D:/Films" --mode movies

Target format:  (Year) - Movie Title - Resolution.ext
Example:        (2010) - Inception - 1080p.mkv

Requirements:
    pip install requests colorama
"""

# ──────────────────────────────────────────────────────────────────────────────
# DEPENDENCY CHECK  (must run first so the error message is clear)
# ──────────────────────────────────────────────────────────────────────────────
import sys

_MISSING = []
try:
    import requests
except ImportError:
    _MISSING.append("requests")

try:
    import colorama
    from colorama import Fore, Style
    colorama.init(autoreset=True)
except ImportError:
    _MISSING.append("colorama")

if _MISSING:
    print("\n[ERROR] Missing packages. Install with:")
    print(f"    pip install {' '.join(_MISSING)}\n")
    sys.exit(1)

# ──────────────────────────────────────────────────────────────────────────────
# IMPORTS
# ──────────────────────────────────────────────────────────────────────────────
import os
import re
import csv
import json
import time
import difflib
import datetime
import argparse
import configparser
from pathlib import Path


# ══════════════════════════════════════════════════════════════════════════════
# CONFIG  — edit these constants to tune behaviour
# ══════════════════════════════════════════════════════════════════════════════
class Config:
    VIDEO_EXTENSIONS = frozenset({
        ".mkv", ".mp4", ".avi", ".mov", ".m4v",
        ".wmv", ".ts", ".m2ts", ".mpg", ".mpeg",
    })
    SUBTITLE_EXTENSIONS = frozenset({
        ".srt", ".ass", ".ssa", ".sub", ".vtt",
    })

    # Files whose names contain these words are silently ignored
    IGNORE_KEYWORDS = frozenset({"sample", "trailer", "preview"})

    # When one of these tokens appears in a filename, everything from that
    # point onward is treated as release junk — not part of the movie title.
    JUNK_TOKENS = frozenset({
        "bluray", "blu-ray", "bdrip", "brrip", "webrip", "web-dl",
        "webdl", "hdtv", "dvdrip", "dvdscr", "hdrip", "remux",
        "hdcam", "r5", "scr", "pdvd",
        "aac", "ac3", "dts", "truehd", "atmos", "flac", "mp3",
        "eac3", "ddp", "opus", "aac5.1", "aac5",
        "x264", "x265", "h264", "h265", "hevc", "avc", "av1",
        "xvid", "divx", "mpeg2", "10bit", "12bit", "hdr", "hdr10",
        "dolby", "vision",
        "yify", "yts", "rarbg", "psa", "galaxyrg", "etrg", "fgt",
        "ion10", "qxr", "ntg", "ctrlhd", "sparks", "d3g",
        "sujaidr", "mkvcinemas", "mkvcage", "tigole", "framestor",
        "flux", "amzn", "nf", "dsnp", "egydead", "egydead.com", "cimawbas",
        "remastered", "repack", "proper", "real", "dubbed", "subbed",
        "multisub", "retail", "readnfo", "nfofix", "internal", "limited", "extended",
    })

    # Resolution priority: index 0 = best
    RESOLUTION_PRIORITY = ["8K", "4K", "2160p", "1440p", "1080p", "720p", "480p"]

    # ── Confidence thresholds ──────────────────────────────────────────────
    MIN_TITLE_SIMILARITY = 0.50   # below this  → skip (low confidence)
    AMBIGUITY_MARGIN     = 0.05   # gap < this  → skip (two candidates too close)
    MIN_POPULARITY       = 0.5    # below this  → skip (too obscure)
    MAX_CANDIDATES       = 8      # how many TMDb results to score

    ALREADY_CORRECT_RE  = re.compile(r"^\(\d{4}\) - .+")
    WINDOWS_ILLEGAL_RE  = re.compile(r'[\\/*?"<>|]')

    TMDB_BASE_URL           = "https://api.themoviedb.org/3"
    TMDB_RATE_LIMIT_CALLS   = 40
    TMDB_RATE_LIMIT_WINDOW  = 10.0   # seconds

    # API key stored here so you don't re-type it every run
    CONFIG_FILE = Path.home() / ".movie_renamer_config.ini"


# ══════════════════════════════════════════════════════════════════════════════
# PERSISTENT CONFIG  (saves TMDb API key between runs)
# ══════════════════════════════════════════════════════════════════════════════
class AppConfig:
    def __init__(self):
        self._cfg  = configparser.ConfigParser()
        self._path = Config.CONFIG_FILE

    def load_api_key(self):
        if self._path.exists():
            self._cfg.read(self._path)
            return self._cfg.get("tmdb", "api_key", fallback=None) or None
        return None

    def save_api_key(self, key):
        self._cfg.setdefault("tmdb", {})["api_key"] = key
        with open(self._path, "w", encoding="utf-8") as f:
            self._cfg.write(f)


# ══════════════════════════════════════════════════════════════════════════════
# DATA CLASSES
# ══════════════════════════════════════════════════════════════════════════════
class SubtitleFile:
    """
    One subtitle file paired with a movie.
    Auto-detects language codes:
        Movie.ar.srt  →  lang_suffix = ".ar",  ext = ".srt"
        Movie.srt     →  lang_suffix = "",      ext = ".srt"
    """
    _LANG = re.compile(r"^[a-z]{2,3}$")

    def __init__(self, path):
        self.path        = path
        self.ext         = path.suffix.lower()
        self.lang_suffix = self._detect(path)

    @classmethod
    def _detect(cls, path):
        stem = path.stem                          # e.g. "Movie.ar"
        if "." in stem:
            before, _, tag = stem.rpartition(".")
            if before and cls._LANG.match(tag):
                return f".{tag}"
        return ""

    def __repr__(self):
        return f"SubtitleFile({self.path.name!r})"


class MovieEntry:
    """One movie file plus its paired subtitles. State accumulates through the pipeline."""

    def __init__(self, path, subtitles):
        self.path         = path
        self.subtitles    = subtitles   # list[SubtitleFile]
        self.ext          = path.suffix
        self.year         = None
        self.resolution   = None
        self.search_query = None
        self.tmdb_result  = None
        self.new_stem     = None        # e.g. "(2010) - Inception - 1080p"
        self.confidence   = 0.0
        self.status       = "pending"   # pending|queued|correct|skipped|renamed
        self.skip_reason  = ""


# ══════════════════════════════════════════════════════════════════════════════
# FILE SCANNER
# ══════════════════════════════════════════════════════════════════════════════
class FileScanner:
    """Walks the folder tree and pairs each video with matching subtitle(s)."""

    @staticmethod
    def _ignore(name):
        n = name.lower()
        return any(k in n for k in Config.IGNORE_KEYWORDS)

    @staticmethod
    def _sub_bare_stem(p):
        """Strip the language tag from a subtitle stem: 'Movie.ar' → 'Movie'."""
        s = p.stem
        if "." in s:
            before, _, tag = s.rpartition(".")
            if before and re.match(r"^[a-z]{2,3}$", tag, re.I):
                return before
        return s

    @classmethod
    def scan(cls, root):
        videos, subs = [], []
        for dp, _, files in os.walk(root):
            d = Path(dp)
            for f in files:
                if cls._ignore(f):
                    continue
                p   = d / f
                ext = p.suffix.lower()
                if   ext in Config.VIDEO_EXTENSIONS:    videos.append(p)
                elif ext in Config.SUBTITLE_EXTENSIONS: subs.append(p)

        # Index subtitles: (parent_dir, bare_stem) → [SubtitleFile, …]
        sub_idx = {}
        for sp in subs:
            key = (sp.parent, cls._sub_bare_stem(sp))
            sub_idx.setdefault(key, []).append(SubtitleFile(sp))

        return [
            MovieEntry(vp, sub_idx.get((vp.parent, vp.stem), []))
            for vp in sorted(videos)
        ]


# ══════════════════════════════════════════════════════════════════════════════
# FILENAME ANALYZER
# ══════════════════════════════════════════════════════════════════════════════
class FilenameAnalyzer:
    """
    Intelligently extracts resolution, release year, and clean movie query.
    Preserves 4-digit numbers in titles (e.g. Blade Runner 2049, 1917, 2001: A Space Odyssey).
    """

    @staticmethod
    def extract_resolution(name):
        lo = name.lower()
        for r in Config.RESOLUTION_PRIORITY:
            if re.search(r"\b" + re.escape(r.lower()) + r"\b", lo):
                return r
        return None

    @staticmethod
    def parse(name):
        """
        Returns: (query, year, resolution)
        """
        stem = Path(name).stem
        resolution = FilenameAnalyzer.extract_resolution(name)

        # 1. Look for explicit year in brackets/parentheses: ( 2017 ), [2022], etc.
        bracket_year_match = re.search(r"[\(\[\{]\s*((?:19|20)\d{2})\s*[\)\]\}]", stem)
        year = None
        if bracket_year_match:
            year = bracket_year_match.group(1)
            raw = stem[:bracket_year_match.start()] + " " + stem[bracket_year_match.end():]
        else:
            raw = stem

        # Replace separators with spaces
        s = raw.replace(".", " ").replace("_", " ").replace("-", " ")

        # Strip bracketed release tags like [YTS.MX], [Cimawbas], [1080p]
        s = re.sub(r"\[.*?\]", " ", s)
        s = re.sub(r"\(.*?\)", " ", s)

        # Strip resolution tokens
        s = re.sub(r"\b(?:480p|720p|1080p|1440p|2160p|4k|8k)\b", " ", s, flags=re.IGNORECASE)

        # Split into words/tokens
        words = s.split()
        clean_words = []

        for w in words:
            w_lower = w.lower()

            # Stop at release junk tokens
            if w_lower in Config.JUNK_TOKENS:
                break

            # If no year was found yet, check if this token is a 4-digit year (1900-2099)
            if not year and re.fullmatch(r"(?:19|20)\d{2}", w):
                year = w
                # In scene release names, the year usually demarcates the end of the title
                break

            clean_words.append(w)

        query = " ".join(clean_words).strip()
        query = re.sub(r"\s+", " ", query)

        return query, year, resolution


# ══════════════════════════════════════════════════════════════════════════════
# TMDB CLIENT
# ══════════════════════════════════════════════════════════════════════════════
class TMDbClient:
    """Rate-limited TMDb v3 wrapper with year-aware fuzzy scoring."""

    def __init__(self, api_key):
        self.api_key   = api_key
        self._sess     = requests.Session()
        self._sess.headers["User-Agent"] = "MovieRenamer/1.2"
        self._times    = []

    # ── Rate limiting ──────────────────────────────────────────────────────
    def _throttle(self):
        now = time.monotonic()
        w   = Config.TMDB_RATE_LIMIT_WINDOW
        self._times = [t for t in self._times if now - t < w]
        if len(self._times) >= Config.TMDB_RATE_LIMIT_CALLS:
            time.sleep(w - (now - self._times[0]) + 0.05)
        self._times.append(time.monotonic())

    def _get(self, endpoint, params):
        self._throttle()
        try:
            r = self._sess.get(
                Config.TMDB_BASE_URL + endpoint,
                params={**params, "api_key": self.api_key},
                timeout=10,
            )
            r.raise_for_status()
            return r.json()
        except requests.RequestException:
            return None

    def validate_api_key(self):
        return self._get("/configuration", {}) is not None

    # ── String Normalization & Similarity ──────────────────────────────────
    @staticmethod
    def _normalize(t):
        if not t:
            return ""
        t = t.lower()
        t = re.sub(r"&", "and", t)
        t = re.sub(r"[:\-–—_.,!?'\"()\[\]{}]", " ", t)
        return re.sub(r"\s+", " ", t).strip()

    @staticmethod
    def _sim(q, title):
        norm_q = TMDbClient._normalize(q)
        norm_t = TMDbClient._normalize(title)
        if not norm_q or not norm_t:
            return 0.0
        if norm_q == norm_t:
            return 1.0

        # Exact sequence ratio
        ratio = difflib.SequenceMatcher(None, norm_q, norm_t).ratio()

        # Token overlap ratio (e.g. for subtitles or alternate wordings)
        q_words = set(norm_q.split())
        t_words = set(norm_t.split())
        if q_words and t_words:
            jaccard = len(q_words & t_words) / len(q_words | t_words)
            ratio = max(ratio, jaccard)

        return ratio

    def _score(self, q, r, year=None):
        base = max(self._sim(q, r.get("title", "")),
                   self._sim(q, r.get("original_title", "")))

        # Year match bonus / penalty
        release_date = r.get("release_date", "")
        cand_year = release_date[:4] if len(release_date) >= 4 else ""
        year_bonus = 0.0
        if year:
            if cand_year == str(year):
                year_bonus = 0.25
            elif cand_year and abs(int(cand_year) - int(year)) <= 1:
                year_bonus = 0.15
            else:
                year_bonus = -0.30

        if r.get("vote_count", 0) < 5:
            base *= 0.7

        pop_bonus = min(r.get("popularity", 0.0) / 200.0, 0.15)
        return base + year_bonus + pop_bonus, base, cand_year

    # ── Search ─────────────────────────────────────────────────────────────
    def search(self, query, year=None):
        """Return (result_dict, score, reason) or (None, score, reason)."""
        if not query:
            return None, 0.0, "Could not extract title"

        # 1. Search with year parameter if available
        results = []
        if year:
            data = self._get("/search/movie", {
                "query": query, "year": str(year),
                "include_adult": "false", "language": "en-US",
            })
            if data and data.get("results"):
                results = data["results"]

        # 2. If no results with year filter (or no year), query without year
        if not results:
            data = self._get("/search/movie", {
                "query": query,
                "include_adult": "false", "language": "en-US",
            })
            if data and data.get("results"):
                results = data["results"]

        if not results:
            return None, 0.0, "No TMDb results"

        # Rank candidates
        scored = []
        for r in results[:Config.MAX_CANDIDATES]:
            final_score, base_sim, cand_year = self._score(query, r, year)
            scored.append((final_score, base_sim, cand_year, r))

        scored.sort(key=lambda x: x[0], reverse=True)
        best_score, best_sim, best_year, best_cand = scored[0]

        year_matched = bool(year and best_year == str(year))

        # Check confidence: if year matched and TMDb returned it, or sim >= threshold
        if not year_matched and best_sim < Config.MIN_TITLE_SIMILARITY:
            return None, best_sim, f"Low confidence ({best_sim:.0%})"

        # Check ambiguity only if top 2 candidates have very close scores and different titles
        if len(scored) > 1:
            second_score, second_sim, second_year, second_cand = scored[1]
            if best_sim < 0.95 and not year_matched:
                diff = best_score - second_score
                if diff < Config.AMBIGUITY_MARGIN:
                    norm1 = self._normalize(best_cand.get("title", ""))
                    norm2 = self._normalize(second_cand.get("title", ""))
                    if norm1 != norm2:
                        return None, best_score, "Ambiguous match"

        if best_cand.get("popularity", 0.0) < Config.MIN_POPULARITY and not year_matched:
            return None, best_score, "Low popularity"

        return best_cand, best_score, "OK"


# ══════════════════════════════════════════════════════════════════════════════
# FILENAME BUILDER
# ══════════════════════════════════════════════════════════════════════════════
class FilenameBuilder:
    """Builds the final Windows-safe standardized filename from a TMDb result."""

    @staticmethod
    def _safe(title):
        t = title.replace(": ", " - ").replace(":", " - ")
        t = Config.WINDOWS_ILLEGAL_RE.sub("", t)
        t = re.sub(r"[ \t]{2,}", " ", t)
        t = re.sub(r" - - ", " - ", t)
        return t.strip()

    @staticmethod
    def build_stem(result, resolution):
        title = result.get("title", "Unknown")
        rd    = result.get("release_date", "")
        year  = rd[:4] if len(rd) >= 4 else "????"
        t     = FilenameBuilder._safe(title)
        return f"({year}) - {t} - {resolution}" if resolution else f"({year}) - {t}"

    @staticmethod
    def sub_name(stem, sub):
        return f"{stem}{sub.lang_suffix}{sub.ext}"

    @staticmethod
    def already_correct(stem):
        return bool(Config.ALREADY_CORRECT_RE.match(stem))


# ══════════════════════════════════════════════════════════════════════════════
# PREVIEW RENDERER
# ══════════════════════════════════════════════════════════════════════════════
class PreviewRenderer:
    H = "=" * 72
    S = "-" * 72

    @classmethod
    def render(cls, entries):
        print(f"\n{Fore.CYAN}{Style.BRIGHT}{cls.H}")
        print("  PREVIEW  --  PROPOSED RENAMES")
        print(f"{cls.H}{Style.RESET_ALL}\n")

        c = {"queued": 0, "correct": 0, "skipped": 0}
        for e in entries:
            if   e.status == "queued":  c["queued"]  += 1; cls._rename(e)
            elif e.status == "correct": c["correct"] += 1; cls._correct(e)
            elif e.status == "skipped": c["skipped"] += 1; cls._skip(e)

        print(f"{Fore.CYAN}{cls.S}{Style.RESET_ALL}")
        print(
            f"  {Fore.GREEN}{Style.BRIGHT}[+] Will rename : {c['queued']}{Style.RESET_ALL}   "
            f"{Fore.YELLOW}{Style.BRIGHT}[=] Already correct : {c['correct']}{Style.RESET_ALL}   "
            f"{Fore.RED}{Style.BRIGHT}[-] Skipped : {c['skipped']}{Style.RESET_ALL}"
        )
        print(f"{Fore.CYAN}{cls.S}{Style.RESET_ALL}\n")

    @classmethod
    def _rename(cls, e):
        print(f"  {Fore.GREEN}{Style.BRIGHT}[RENAME]{Style.RESET_ALL}")
        print(f"    {Style.DIM}OLD:{Style.RESET_ALL} {e.path.name}")
        print(f"    {Fore.GREEN}NEW:{Style.RESET_ALL} {e.new_stem}{e.ext}")
        for s in e.subtitles:
            print(f"      {Style.DIM}SUB OLD:{Style.RESET_ALL} {s.path.name}")
            print(f"      {Fore.GREEN}SUB NEW:{Style.RESET_ALL} {FilenameBuilder.sub_name(e.new_stem, s)}")
        print()

    @classmethod
    def _correct(cls, e):
        print(f"  {Fore.YELLOW}{Style.BRIGHT}[CORRECT]{Style.RESET_ALL}")
        print(f"    {e.path.name}\n")

    @classmethod
    def _skip(cls, e):
        print(f"  {Fore.RED}{Style.BRIGHT}[SKIP]{Style.RESET_ALL}  {Fore.RED}[{e.skip_reason}]{Style.RESET_ALL}")
        print(f"    {e.path.name}\n")


# ══════════════════════════════════════════════════════════════════════════════
# RENAME ENGINE
# ══════════════════════════════════════════════════════════════════════════════
class RenameEngine:
    """
    Renames movie first, then immediately all its subtitles.
    Never overwrites an existing file. Records everything for undo/log.
    """

    def __init__(self):
        self.log_records = []
        self.undo_pairs  = []

    def _rec(self, old, new, status, reason=""):
        ts = datetime.datetime.now().isoformat(timespec="seconds")
        self.log_records.append({
            "old_name": str(old), "new_name": str(new),
            "status": status, "reason": reason, "timestamp": ts,
        })
        if status == "renamed":
            self.undo_pairs.append({"old": str(old), "new": str(new)})

    def rename_entry(self, entry):
        new_name = f"{entry.new_stem}{entry.ext}"
        new_path = entry.path.parent / new_name

        # Safety: never overwrite a different existing file
        if new_path.exists() and new_path.resolve() != entry.path.resolve():
            r = f"Target already exists: {new_name}"
            entry.status = "skipped"; entry.skip_reason = r
            self._rec(entry.path, new_path, "skipped", r); return

        try:
            entry.path.rename(new_path)
            self._rec(entry.path, new_path, "renamed")
        except PermissionError:
            r = "Permission denied"
            entry.status = "skipped"; entry.skip_reason = r
            self._rec(entry.path, new_path, "skipped", r); return
        except OSError as exc:
            r = str(exc)
            entry.status = "skipped"; entry.skip_reason = r
            self._rec(entry.path, new_path, "skipped", r); return

        # Immediately rename every paired subtitle
        for sub in entry.subtitles:
            sn  = FilenameBuilder.sub_name(entry.new_stem, sub)
            sp  = sub.path.parent / sn
            if sp.exists() and sp.resolve() != sub.path.resolve():
                self._rec(sub.path, sp, "skipped", "Subtitle target already exists")
                continue
            try:
                sub.path.rename(sp)
                self._rec(sub.path, sp, "renamed")
            except (PermissionError, OSError) as exc:
                self._rec(sub.path, sp, "skipped", str(exc))

        entry.status = "renamed"


# ══════════════════════════════════════════════════════════════════════════════
# LOGGER
# ══════════════════════════════════════════════════════════════════════════════
class Logger:
    def __init__(self, root):
        ts             = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        self.txt_path  = root / f"Rename Log {ts}.txt"
        self.csv_path  = root / f"Rename Log {ts}.csv"

    def write(self, records):
        with open(self.txt_path, "w", encoding="utf-8") as f:
            f.write("Movie Renamer -- Rename Log\n")
            f.write(f"Generated : {datetime.datetime.now()}\n")
            f.write("-" * 80 + "\n\n")
            for r in records:
                f.write(f"[{r['status'].upper()}]  {r['timestamp']}\n")
                f.write(f"  OLD : {r['old_name']}\n")
                f.write(f"  NEW : {r['new_name']}\n")
                if r.get("reason"): f.write(f"  WHY : {r['reason']}\n")
                f.write("\n")

        fields = ["old_name", "new_name", "status", "reason", "timestamp"]
        with open(self.csv_path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader(); w.writerows(records)

        print(f"\n{Fore.CYAN}  Logs:{Style.RESET_ALL}")
        print(f"    {self.txt_path}")
        print(f"    {self.csv_path}")


# ══════════════════════════════════════════════════════════════════════════════
# UNDO WRITER
# ══════════════════════════════════════════════════════════════════════════════
class UndoWriter:
    def __init__(self, root):
        ts               = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        self.json_path   = root / f"undo_renames_{ts}.json"
        self.script_path = root / f"undo_renames_{ts}.py"

    def write(self, pairs):
        with open(self.json_path, "w", encoding="utf-8") as f:
            json.dump(pairs, f, indent=2, ensure_ascii=False)

        jn = self.json_path.name
        sn = self.script_path.name
        with open(self.script_path, "w", encoding="utf-8") as f:
            f.writelines([
                "#!/usr/bin/env python3\n",
                f'"""Undo renames — run: python {sn}"""\n',
                "import json, sys\nfrom pathlib import Path\n\n",
                f'JSON = Path(__file__).parent / "{jn}"\n\n',
                "def main():\n",
                "    if not JSON.exists(): print('Data file not found'); sys.exit(1)\n",
                "    pairs = json.loads(JSON.read_text(encoding='utf-8'))\n",
                "    ok = bad = 0\n",
                "    for p in reversed(pairs):\n",
                "        o, n = Path(p['old']), Path(p['new'])\n",
                "        if not n.exists(): print(f'  NOT FOUND : {n.name}'); bad+=1; continue\n",
                "        if o.exists() and o.resolve()!=n.resolve(): print(f'  CONFLICT  : {o.name}'); bad+=1; continue\n",
                "        try: n.rename(o); print(f'  Restored  : {n.name}  ->  {o.name}'); ok+=1\n",
                "        except OSError as e: print(f'  FAILED    : {e}'); bad+=1\n",
                "    print(f'\\nRestored: {ok}   Failed: {bad}')\n\n",
                "if __name__ == '__main__': main()\n",
            ])

        print(f"\n{Fore.CYAN}  Undo:{Style.RESET_ALL}")
        print(f"    {self.json_path}")
        print(f"    {self.script_path}")


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════
def get_api_key():
    """Load saved key or prompt the user to enter one, then validate it."""
    cfg   = AppConfig()
    saved = cfg.load_api_key()

    if saved:
        print(f"  {Fore.CYAN}Saved TMDb API key found.{Style.RESET_ALL}")
        if input("  Use it? [Y/n]: ").strip().lower() in ("", "y", "yes"):
            return saved

    while True:
        key = input("\n  TMDb API key (free at themoviedb.org/settings/api): ").strip()
        if not key:
            return None
        print("  Validating...", end="", flush=True)
        if TMDbClient(key).validate_api_key():
            print(f"  {Fore.GREEN}Valid!{Style.RESET_ALL}")
            if input("  Save for next time? [Y/n]: ").strip().lower() in ("", "y", "yes"):
                cfg.save_api_key(key)
                print(f"  {Fore.CYAN}Saved to {Config.CONFIG_FILE}{Style.RESET_ALL}")
            return key
        print(f"\r  {Fore.RED}Invalid key or no internet connection.{Style.RESET_ALL}")
        if input("  Try again? [Y/n]: ").strip().lower() not in ("", "y", "yes"):
            return None


def eta(secs):
    if secs < 60:   return f"{int(secs)}s"
    if secs < 3600: return f"{int(secs//60)}m {int(secs%60)}s"
    return f"{int(secs//3600)}h {int((secs%3600)//60)}m"


def analyze(entries, client):
    """TMDb-search every entry and populate status + new_stem."""
    total = len(entries)
    t0    = time.monotonic()

    for i, e in enumerate(entries, 1):
        el  = time.monotonic() - t0
        est = eta((total - i + 1) / ((i - 1) / el)) if i > 1 and el > 0 else "..."
        print(f"\r  {Fore.CYAN}[{i}/{total}]{Style.RESET_ALL} Searching TMDb...  ETA: {est}        ",
              end="", flush=True)

        stem = e.path.stem

        # Already in the right format?
        if FilenameBuilder.already_correct(stem):
            e.status = "correct"; e.skip_reason = "Already correctly named"; continue

        query, year, resolution = FilenameAnalyzer.parse(e.path.name)
        e.search_query = query
        e.year         = year
        e.resolution   = resolution

        if not e.search_query:
            e.status = "skipped"; e.skip_reason = "Could not extract title"; continue

        result, score, reason = client.search(e.search_query, e.year)
        e.confidence  = score

        if result is None:
            e.status = "skipped"
            e.skip_reason = reason
            continue

        e.tmdb_result = result
        e.new_stem    = FilenameBuilder.build_stem(result, e.resolution)
        e.status      = "correct" if e.new_stem == stem else "queued"
        if e.status == "correct": e.skip_reason = "Already correctly named"

    print()


def summary(entries, elapsed):
    total   = len(entries)
    renamed = sum(1 for e in entries if e.status == "renamed")
    correct = sum(1 for e in entries if e.status == "correct")
    skipped = [e for e in entries if e.status == "skipped"]
    s_tmdb  = sum(1 for e in skipped if any(k in e.skip_reason.lower()
                  for k in ("tmdb","confidence","ambiguous","results","title","popularity")))
    s_perm  = sum(1 for e in skipped if "permission" in e.skip_reason.lower())
    s_other = len(skipped) - s_tmdb - s_perm

    print(f"\n{Fore.CYAN}{Style.BRIGHT}{'='*52}")
    print("  SUMMARY")
    print(f"{'='*52}{Style.RESET_ALL}")
    print(f"  Movies scanned       : {total}")
    print(f"  {Fore.GREEN}Renamed              : {renamed}{Style.RESET_ALL}")
    print(f"  {Fore.YELLOW}Already correct      : {correct}{Style.RESET_ALL}")
    print(f"  {Fore.RED}Skipped (TMDb)       : {s_tmdb}{Style.RESET_ALL}")
    print(f"  {Fore.RED}Skipped (Permission) : {s_perm}{Style.RESET_ALL}")
    print(f"  {Fore.RED}Skipped (Other)      : {s_other}{Style.RESET_ALL}")
    print(f"  Elapsed time         : {eta(elapsed)}")
    print(f"{Fore.CYAN}{'='*52}{Style.RESET_ALL}\n")


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════
def main():
    parser = argparse.ArgumentParser(description="Intelligent Movie Renaming Tool — Powered by TMDb")
    parser.add_argument("--folder", "-f", default=None, help="Target folder to scan (default: current directory)")
    parser.add_argument("--mode", default="movies", help="Scan mode (default: movies)")
    parser.add_argument("--dry-run", action="store_true", help="Preview renames without executing")
    args = parser.parse_args()

    print(f"\n{Fore.CYAN}{Style.BRIGHT}")
    print("  +--------------------------------------------------+")
    print("  |  Intelligent Movie Renamer  v1.2.0               |")
    print("  |  Powered by TMDb (The Movie Database)            |")
    print("  +--------------------------------------------------+")
    print(Style.RESET_ALL)

    # ── Target folder ──────────────────────────────────────────────────────
    folder = Path(args.folder).resolve() if args.folder else Path.cwd()
    if not folder.exists() or not folder.is_dir():
        print(f"  {Fore.RED}Error: Folder does not exist: {folder}{Style.RESET_ALL}\n")
        sys.exit(1)

    print(f"  {Fore.CYAN}Target folder:{Style.RESET_ALL} {Fore.WHITE}{folder}{Style.RESET_ALL}")
    print(f"  {Style.DIM}Subfolders will also be scanned recursively.{Style.RESET_ALL}\n")

    # ── API Key ────────────────────────────────────────────────────────────
    api_key = get_api_key()
    if not api_key:
        print(f"\n  {Fore.RED}No API key provided. Exiting.{Style.RESET_ALL}\n")
        sys.exit(0)

    # ── Scan ───────────────────────────────────────────────────────────────
    print(f"\n  Scanning {folder} ...")
    entries = FileScanner.scan(folder)
    if not entries:
        print(f"  {Fore.YELLOW}No movie files found.{Style.RESET_ALL}\n")
        sys.exit(0)
    subs = sum(len(e.subtitles) for e in entries)
    print(f"  Found {Fore.WHITE}{len(entries)}{Style.RESET_ALL} movie(s)"
          f" and {Fore.WHITE}{subs}{Style.RESET_ALL} subtitle(s).")

    # ── Analyze ────────────────────────────────────────────────────────────
    print()
    analyze(entries, TMDbClient(api_key))

    # ── Preview ────────────────────────────────────────────────────────────
    PreviewRenderer.render(entries)

    queued = [e for e in entries if e.status == "queued"]
    if not queued:
        print(f"  {Fore.YELLOW}Nothing to rename.{Style.RESET_ALL}\n")
        sys.exit(0)

    if args.dry_run:
        print(f"  {Fore.CYAN}Dry run complete. No files were modified.{Style.RESET_ALL}\n")
        sys.exit(0)

    # ── Confirm ────────────────────────────────────────────────────
    ans = input(
        f"  Rename {Fore.WHITE}{len(queued)}{Style.RESET_ALL} file(s)? [Y/n]: "
    ).strip().lower()
    if ans not in ("", "y", "yes"):
        print(f"\n  {Fore.YELLOW}Aborted. Nothing was renamed.{Style.RESET_ALL}\n")
        sys.exit(0)

    # ── Rename ─────────────────────────────────────────────────────
    print()
    t0     = time.monotonic()
    engine = RenameEngine()
    for i, e in enumerate(queued, 1):
        print(f"\r  [{i}/{len(queued)}] {e.path.name[:60]}...", end="", flush=True)
        engine.rename_entry(e)
    print()
    elapsed = time.monotonic() - t0

    # Add non-renamed entries to the log
    ts = datetime.datetime.now().isoformat(timespec="seconds")
    for e in entries:
        if e.status == "correct":
            engine.log_records.append({
                "old_name": str(e.path), "new_name": str(e.path),
                "status": "correct", "reason": "Already correctly named", "timestamp": ts,
            })
        elif e.status == "skipped":
            engine.log_records.append({
                "old_name": str(e.path), "new_name": "",
                "status": "skipped", "reason": e.skip_reason, "timestamp": ts,
            })

    # ── Logs + Undo ────────────────────────────────────────────────────────
    Logger(folder).write(engine.log_records)
    if engine.undo_pairs:
        UndoWriter(folder).write(engine.undo_pairs)
    else:
        print(f"  {Fore.YELLOW}No files renamed — undo data not written.{Style.RESET_ALL}")

    summary(entries, elapsed)


if __name__ == "__main__":
    main()

