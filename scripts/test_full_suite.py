import os
import re
import csv
import json
import time
import shutil
import tempfile
from pathlib import Path

# ==============================================================================
# CONFIG
# ==============================================================================
class Config:
    VERSION = "1.3.0"
    VIDEO_EXTENSIONS = frozenset({
        ".mkv", ".mp4", ".avi", ".mov", ".m4v",
        ".wmv", ".ts", ".m2ts", ".mpg", ".mpeg",
        ".webm", ".flv", ".vob", ".iso",
    })
    SUBTITLE_EXTENSIONS = frozenset({
        ".srt", ".ass", ".ssa", ".sub", ".vtt", ".idx", ".smi", ".sami",
    })

    IGNORE_KEYWORDS = frozenset({"sample", "trailer", "preview", "extras", "featurette"})
    SUBS_DIR_NAMES = frozenset({"subs", "subtitles", "sub", "feature.subs", "sub_titles"})

    JUNK_TOKENS = frozenset({
        "bluray", "blu-ray", "bdrip", "brrip", "webrip", "web-dl",
        "webdl", "hdtv", "dvdrip", "dvdscr", "hdrip", "remux",
        "hdcam", "r5", "scr", "pdvd", "camrip", "telesync", "ts",
        "uhd", "imax", "3d", "sdr", "hdr", "hdr10", "hdr10plus", "dv", "dolby", "vision",
        "x264", "x265", "h264", "h265", "hevc", "avc", "av1", "xvid", "divx", "mpeg2",
        "10bit", "12bit", "8bit",
        "aac", "ac3", "dts", "dts-hd", "dtshd", "truehd", "atmos", "flac", "mp3",
        "eac3", "ddp", "ddp5.1", "dd5.1", "opus", "aac5.1", "aac5", "2ch", "6ch", "8ch",
        "yify", "yts", "yts.mx", "yts.lt", "yts.ag", "rarbg", "psa", "galaxyrg", "galaxy616",
        "etrg", "fgt", "ion10", "qxr", "ntg", "ctrlhd", "sparks", "d3g",
        "sujaidr", "mkvcinemas", "mkvcage", "tigole", "framestor", "flux",
        "amzn", "nf", "dsnp", "hmax", "atvp", "itunes", "pahe",
        "egydead", "egydead.com", "cimawbas", "akoam", "myegy", "arabseed", "wecima",
        "faselhd", "cimatelegram", "shahid4u", "cima4u", "arabp2p", "cimalek", "arablionz",
        "remastered", "repack", "proper", "real", "dubbed", "subbed",
        "multisub", "multi", "retail", "readnfo", "nfofix", "internal", "limited",
        "extended", "unrated", "directors", "cut", "edition", "theatrical",
        "dual", "audio", "hindi", "tamil", "telugu", "clean", "fixed",
    })

    RESOLUTION_PRIORITY = ["8K", "4K", "2160p", "1440p", "1080p", "720p", "480p", "360p"]

    MIN_TITLE_SIMILARITY = 0.50
    AMBIGUITY_MARGIN     = 0.05
    MIN_POPULARITY       = 0.5
    MAX_CANDIDATES       = 8

    ALREADY_CORRECT_RE  = re.compile(r"^\(\d{4}\) - .+")
    WINDOWS_ILLEGAL_RE  = re.compile(r'[\\/*?:"<>|]')

    TMDB_BASE_URL          = "https://api.themoviedb.org/3"
    TMDB_RATE_LIMIT_CALLS  = 40
    TMDB_RATE_LIMIT_WINDOW = 10.0

    CONFIG_FILE = Path.home() / ".movie_renamer_config.ini"


# ==============================================================================
# SUBTITLE FILE & DETECTOR
# ==============================================================================
LANG_MAP = {
    'english': 'en', 'eng': 'en', 'en': 'en',
    'arabic': 'ar', 'ara': 'ar', 'ar': 'ar',
    'french': 'fr', 'fre': 'fr', 'fra': 'fr', 'fr': 'fr',
    'spanish': 'es', 'spa': 'es', 'es': 'es',
    'german': 'de', 'ger': 'de', 'deu': 'de', 'de': 'de',
    'italian': 'it', 'ita': 'it', 'it': 'it',
    'russian': 'ru', 'rus': 'ru', 'ru': 'ru',
    'portuguese': 'pt', 'por': 'pt', 'pt': 'pt',
    'turkish': 'tr', 'tur': 'tr', 'tr': 'tr',
    'japanese': 'ja', 'jpn': 'ja', 'ja': 'ja',
    'korean': 'ko', 'kor': 'ko', 'ko': 'ko',
    'chinese': 'zh', 'chi': 'zh', 'zho': 'zh', 'zh': 'zh',
    'hindi': 'hi', 'hin': 'hi',
    'persian': 'fa', 'per': 'fa', 'fas': 'fa', 'farsi': 'fa',
    'dutch': 'nl', 'dut': 'nl', 'nld': 'nl',
    'polish': 'pl', 'pol': 'pl',
    'swedish': 'sv', 'swe': 'sv',
    'danish': 'da', 'dan': 'da',
    'norwegian': 'no', 'nor': 'no',
    'finnish': 'fi', 'fin': 'fi',
    'greek': 'el', 'gre': 'el', 'ell': 'el',
    'hebrew': 'he', 'heb': 'he',
    'czech': 'cs', 'cze': 'cs', 'ces': 'cs',
    'hungarian': 'hu', 'hun': 'hu',
    'romanian': 'ro', 'rum': 'ro', 'ron': 'ro',
    'indonesian': 'id', 'ind': 'id',
    'vietnamese': 'vi', 'vie': 'vi',
    'thai': 'th', 'tha': 'th',
}

SUB_TAGS = {'forced', 'sdh', 'hi', 'cc', 'default', 'commentary'}

class SubtitleFile:
    def __init__(self, path):
        self.path = path
        self.ext = path.suffix.lower()
        self.bare_stem, self.lang_suffix, self.lang = self._analyze(path.stem)

    @classmethod
    def _analyze(cls, stem):
        tokens = [t for t in re.split(r'[._\- ]+', stem) if t]
        detected_lang = None
        detected_tags = []
        idx = len(tokens) - 1

        while idx >= 0:
            t = tokens[idx].lower()
            t_clean = re.sub(r'^\d+', '', t).strip('_')
            if t in SUB_TAGS:
                detected_tags.insert(0, t)
                idx -= 1
            elif t_clean in LANG_MAP:
                detected_lang = LANG_MAP[t_clean]
                idx -= 1
            elif re.match(r'^[a-z]{2}(?:-[a-z]{2,4})?$', t):
                detected_lang = t.split('-')[0]
                idx -= 1
            else:
                break

        suffix_parts = []
        if detected_lang:
            suffix_parts.append(detected_lang)
        suffix_parts.extend(detected_tags)

        lang_suffix = ('.' + '.'.join(suffix_parts)) if suffix_parts else ''
        remaining = tokens[:idx + 1]
        bare = '.'.join(remaining) if remaining else ''
        return bare, lang_suffix, detected_lang


class MovieEntry:
    def __init__(self, path, subtitles):
        self.path         = path
        self.subtitles    = subtitles   # list[SubtitleFile]
        self.ext          = path.suffix
        self.year         = None
        self.resolution   = None
        self.search_query = None
        self.tmdb_result  = None
        self.new_stem     = None
        self.confidence   = 0.0
        self.status       = "pending"   # pending | queued | correct | skipped | renamed
        self.skip_reason  = ""


# ==============================================================================
# FILE SCANNER
# ==============================================================================
class FileScanner:
    @staticmethod
    def _ignore(name):
        n = name.lower()
        return any(k in n for k in Config.IGNORE_KEYWORDS)

    @staticmethod
    def _norm(s):
        if not s:
            return ""
        return re.sub(r"[^a-z0-9]+", "", s.lower())

    @classmethod
    def scan(cls, root):
        videos, subs = [], []
        for dp, _, files in os.walk(root):
            d = Path(dp)
            for f in files:
                if cls._ignore(f):
                    continue
                p = d / f
                ext = p.suffix.lower()
                if ext in Config.VIDEO_EXTENSIONS:
                    videos.append(p)
                elif ext in Config.SUBTITLE_EXTENSIONS:
                    subs.append(p)

        dir_to_videos = {}
        for vp in sorted(videos):
            dir_to_videos.setdefault(vp.parent, []).append(vp)

        sub_objs = [SubtitleFile(sp) for sp in sorted(subs)]
        video_subs = {vp: [] for vp in videos}
        unmatched_subs = []

        # 1. Base stem matching (exact or prefix)
        for s in sub_objs:
            p_dir = s.path.parent
            effective_dir = p_dir.parent if p_dir.name.lower() in Config.SUBS_DIR_NAMES else p_dir
            candidates = dir_to_videos.get(p_dir, []) or dir_to_videos.get(effective_dir, [])

            matched_video = None
            s_norm = cls._norm(s.bare_stem)

            if s_norm:
                # Exact normalized match
                for vp in candidates:
                    if s_norm == cls._norm(vp.stem):
                        matched_video = vp
                        break
                # Prefix match
                if not matched_video:
                    for vp in candidates:
                        v_norm = cls._norm(vp.stem)
                        if v_norm.startswith(s_norm) and len(s_norm) >= 4:
                            matched_video = vp
                            break

            if matched_video:
                video_subs[matched_video].append(s)
            else:
                unmatched_subs.append((s, effective_dir))

        # 2. Single-movie directory fallback
        for s, eff_dir in unmatched_subs:
            vids = dir_to_videos.get(eff_dir, [])
            if len(vids) == 1:
                video_subs[vids[0]].append(s)

        return [
            MovieEntry(vp, video_subs.get(vp, []))
            for vp in sorted(videos)
        ]


# ==============================================================================
# FILENAME ANALYZER
# ==============================================================================
class FilenameAnalyzer:
    @staticmethod
    def extract_resolution(name):
        lo = name.lower()
        for r in Config.RESOLUTION_PRIORITY:
            if re.search(r"\b" + re.escape(r.lower()) + r"\b", lo):
                return r
        return None

    @staticmethod
    def parse(name):
        stem = Path(name).stem
        resolution = FilenameAnalyzer.extract_resolution(name)

        bracket_year_match = re.search(r"[\(\[\{]\s*((?:19|20)\d{2})\s*[\)\]\}]", stem)
        year = None
        if bracket_year_match:
            year = bracket_year_match.group(1)
            raw = stem[:bracket_year_match.start()] + " " + stem[bracket_year_match.end():]
        else:
            raw = stem

        s = raw.replace(".", " ").replace("_", " ").replace("-", " ")
        s = re.sub(r"\[.*?\]", " ", s)
        s = re.sub(r"\(.*?\)", " ", s)
        s = re.sub(r"\b(?:480p|720p|1080p|1440p|2160p|4k|8k)\b", " ", s, flags=re.IGNORECASE)

        words = s.split()
        cutoff_idx = len(words)
        for i, w in enumerate(words):
            if w.lower() in Config.JUNK_TOKENS:
                cutoff_idx = i
                break

        candidate_words = words[:cutoff_idx]

        if not year:
            year_indices = [
                i for i, w in enumerate(candidate_words)
                if re.fullmatch(r"(?:19|20)\d{2}", w)
            ]
            if year_indices:
                if len(year_indices) == 1 and year_indices[0] == 0 and len(candidate_words) == 1:
                    title_words = candidate_words
                else:
                    target_year_idx = year_indices[-1]
                    year = candidate_words[target_year_idx]
                    title_words = candidate_words[:target_year_idx]
            else:
                title_words = candidate_words
        else:
            title_words = candidate_words

        query = " ".join(title_words).strip()
        query = re.sub(r"\s+", " ", query)

        if not query and year:
            query = year
            year = None

        return query, year, resolution


# ==============================================================================
# FILENAME BUILDER
# ==============================================================================
class FilenameBuilder:
    @staticmethod
    def _safe(title):
        t = title.replace(": ", " - ").replace(":", " - ")
        t = Config.WINDOWS_ILLEGAL_RE.sub("", t)
        t = "".join(ch for ch in t if ord(ch) >= 32)
        t = re.sub(r"[ \t]{2,}", " ", t)
        t = re.sub(r" - - ", " - ", t)
        t = t.strip(" .")
        if t.upper() in {"CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"}:
            t = f"{t}_"
        return t

    @staticmethod
    def build_stem(result, resolution):
        title = result.get("title", "Unknown")
        rd    = result.get("release_date", "")
        year  = rd[:4] if len(rd) >= 4 else "????"
        t     = FilenameBuilder._safe(title)
        return f"({year}) - {t} - {resolution}" if resolution else f"({year}) - {t}"

    @staticmethod
    def plan_subtitles(entry_new_stem, subtitles):
        used_names = set()
        sub_targets = []
        for sub in subtitles:
            base_name = f"{entry_new_stem}{sub.lang_suffix}{sub.ext}"
            target_name = base_name
            counter = 2
            while target_name.lower() in used_names:
                if sub.lang_suffix:
                    target_name = f"{entry_new_stem}{sub.lang_suffix}.{counter}{sub.ext}"
                else:
                    target_name = f"{entry_new_stem}.{counter}{sub.ext}"
                counter += 1
            used_names.add(target_name.lower())
            sub_targets.append((sub, target_name))
        return sub_targets

    @staticmethod
    def already_correct(stem):
        return bool(Config.ALREADY_CORRECT_RE.match(stem))


# ==============================================================================
# RENAME ENGINE
# ==============================================================================
class RenameEngine:
    def __init__(self):
        self.log_records = []
        self.undo_pairs  = []

    def _rec(self, old, new, status, reason=""):
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        self.log_records.append({
            "old_name": str(old), "new_name": str(new),
            "status": status, "reason": reason, "timestamp": ts,
        })
        if status == "renamed":
            self.undo_pairs.append({"old": str(old), "new": str(new)})

    def rename_entry(self, entry):
        new_name = f"{entry.new_stem}{entry.ext}"
        new_path = entry.path.parent / new_name

        movie_renamed = False
        if entry.path.name != new_name:
            if new_path.exists() and new_path.resolve() != entry.path.resolve():
                r = f"Target already exists: {new_name}"
                entry.status = "skipped"; entry.skip_reason = r
                self._rec(entry.path, new_path, "skipped", r)
                return
            try:
                entry.path.rename(new_path)
                self._rec(entry.path, new_path, "renamed")
                movie_renamed = True
            except (PermissionError, OSError) as exc:
                entry.status = "skipped"; entry.skip_reason = str(exc)
                self._rec(entry.path, new_path, "skipped", str(exc))
                return

        # Rename subtitles
        sub_targets = FilenameBuilder.plan_subtitles(entry.new_stem, entry.subtitles)
        subs_renamed = 0
        for sub, sn in sub_targets:
            sp = sub.path.parent / sn
            if sub.path.name == sn:
                # Already correct
                continue
            if sp.exists() and sp.resolve() != sub.path.resolve():
                self._rec(sub.path, sp, "skipped", f"Subtitle target already exists: {sn}")
                continue
            try:
                sub.path.rename(sp)
                self._rec(sub.path, sp, "renamed")
                subs_renamed += 1
            except (PermissionError, OSError) as exc:
                self._rec(sub.path, sp, "skipped", str(exc))

        entry.status = "renamed"


# ==============================================================================
# TEST SUITE EXECUTION
# ==============================================================================
def run_test_suite():
    tmp_root = Path(tempfile.mkdtemp(prefix="renamer_test_"))
    print(f"Created temp test environment: {tmp_root}")

    try:
        # 1. Create directory structure
        # Folder A: Normal movie with Subs/ subfolder
        f_a = tmp_root / "Inception (2010)"
        f_a_subs = f_a / "Subs"
        f_a_subs.mkdir(parents=True)
        (f_a / "Inception.2010.1080p.BluRay.x264.mkv").write_text("dummy")
        (f_a_subs / "English.srt").write_text("sub1")
        (f_a_subs / "Arabic.srt").write_text("sub2")
        (f_a_subs / "2_English.srt").write_text("sub3")

        # Folder B: Movie containing number (1917)
        f_b = tmp_root / "1917.2019"
        f_b.mkdir()
        (f_b / "1917.2019.1080p.WEBRip.mkv").write_text("dummy")
        (f_b / "1917.2019.1080p.ar.srt").write_text("sub")

        # Folder C: Movie with number in title (Blade Runner 2049)
        f_c = tmp_root / "Blade.Runner.2049"
        f_c.mkdir()
        (f_c / "Blade.Runner.2049.2017.1080p.BluRay.mkv").write_text("dummy")
        (f_c / "Blade.Runner.2049.2017.1080p.en.forced.srt").write_text("sub")

        # Folder D: Already correct movie with unrenamed subtitle
        f_d = tmp_root / "Correct Movie"
        f_d.mkdir()
        (f_d / "(2000) - Gladiator - 1080p.mkv").write_text("dummy")
        (f_d / "Gladiator.Arabic.srt").write_text("sub")

        # Run FileScanner
        entries = FileScanner.scan(tmp_root)
        print(f"\nScanned {len(entries)} movies.")
        for e in entries:
            print(f"Movie: {e.path.name} | Subtitles count: {len(e.subtitles)}")
            for s in e.subtitles:
                print(f"   -> Sub: {s.path.name} (bare={s.bare_stem!r}, suffix={s.lang_suffix!r})")

        # Mock TMDB Analysis
        mock_tmdb = {
            "Inception": {"title": "Inception", "release_date": "2010-07-16"},
            "1917": {"title": "1917", "release_date": "2019-12-25"},
            "Blade Runner 2049": {"title": "Blade Runner 2049", "release_date": "2017-10-06"},
            "Gladiator": {"title": "Gladiator", "release_date": "2000-05-05"},
        }

        for e in entries:
            stem = e.path.stem
            if FilenameBuilder.already_correct(stem):
                e.new_stem = stem
                # Check subtitles
                sub_targets = FilenameBuilder.plan_subtitles(e.new_stem, e.subtitles)
                needs_sub_rename = any(sub.path.name != sn for sub, sn in sub_targets)
                if needs_sub_rename:
                    e.status = "queued"
                else:
                    e.status = "correct"
                continue

            query, year, res = FilenameAnalyzer.parse(e.path.name)
            e.resolution = res
            tmdb_match = mock_tmdb.get(query)
            if tmdb_match:
                e.new_stem = FilenameBuilder.build_stem(tmdb_match, e.resolution)
                e.status = "queued"
            else:
                e.status = "skipped"
                e.skip_reason = "No mock match"

        # Execute Renaming
        engine = RenameEngine()
        queued = [e for e in entries if e.status == "queued"]
        for e in queued:
            engine.rename_entry(e)

        print("\nRenaming complete. Log records:")
        for r in engine.log_records:
            print(f"[{r['status'].upper()}] {Path(r['old_name']).name} -> {Path(r['new_name']).name}")

        # Check all files in tmp_root
        print("\nFinal File Tree:")
        for dp, _, files in os.walk(tmp_root):
            for f in sorted(files):
                print(f"  {Path(dp).name} / {f}")

        # Test Undo
        print("\nTesting Undo...")
        for p in reversed(engine.undo_pairs):
            o, n = Path(p["old"]), Path(p["new"])
            assert n.exists(), f"Target {n} must exist for undo"
            n.rename(o)

        print("Undo succeeded! Verifying restored names...")
        for e in entries:
            assert e.path.exists(), f"Original file {e.path} was restored!"

        print("\nALL TEST SUITE CHECKS PASSED SUCCESSFULLY!")

    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)

if __name__ == "__main__":
    run_test_suite()
