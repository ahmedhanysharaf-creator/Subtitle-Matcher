import re
from pathlib import Path

class Config:
    RESOLUTION_PRIORITY = ["8K", "4K", "2160p", "1440p", "1080p", "720p", "480p", "360p"]
    JUNK_TOKENS = frozenset({
        "bluray", "blu-ray", "bdrip", "brrip", "webrip", "web-dl",
        "webdl", "hdtv", "dvdrip", "dvdscr", "hdrip", "remux",
        "hdcam", "r5", "scr", "pdvd", "camrip", "telesync",
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
        
        # 1. Check for explicit bracketed year: (2017), [2022], {1999}
        bracket_year_match = re.search(r"[\(\[\{]\s*((?:19|20)\d{2})\s*[\)\]\}]", stem)
        year = None
        if bracket_year_match:
            year = bracket_year_match.group(1)
            raw = stem[:bracket_year_match.start()] + " " + stem[bracket_year_match.end():]
        else:
            raw = stem

        # Replace separators with spaces
        s = raw.replace(".", " ").replace("_", " ").replace("-", " ")

        # Strip brackets contents like [YTS.MX], [Cimawbas]
        s = re.sub(r"\[.*?\]", " ", s)
        s = re.sub(r"\(.*?\)", " ", s)

        # Strip resolution tokens
        s = re.sub(r"\b(?:480p|720p|1080p|1440p|2160p|4k|8k)\b", " ", s, flags=re.IGNORECASE)

        words = s.split()
        
        # Find junk cutoff point
        cutoff_idx = len(words)
        for i, w in enumerate(words):
            if w.lower() in Config.JUNK_TOKENS:
                cutoff_idx = i
                break
                
        candidate_words = words[:cutoff_idx]
        
        # If year was not found via brackets, look for year among candidate words
        if not year:
            # Find all 4-digit numbers (1900-2099)
            year_indices = [
                i for i, w in enumerate(candidate_words)
                if re.fullmatch(r"(?:19|20)\d{2}", w)
            ]
            if year_indices:
                # If there are multiple year tokens or the token is after title words,
                # the release year is the LAST 4-digit number (e.g. Blade Runner 2049 2017 -> 2017)
                # But if there's only 1 year token and it's at index 0 (e.g. 1917 1080p),
                # it might be the movie title itself!
                if len(year_indices) == 1 and year_indices[0] == 0 and len(candidate_words) == 1:
                    # e.g. "1917" -> query is "1917", year is None
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
        
        # Fallback: if query became empty (e.g. movie was literally named "1917" and year was picked as 1917)
        if not query and year:
            query = year
            year = None

        return query, year, resolution

tests = [
    "Blade.Runner.2049.2017.1080p.BluRay.x264.mkv",
    "1917.2019.1080p.mkv",
    "2001.A.Space.Odyssey.1968.1080p.mkv",
    "2012.2009.1080p.mkv",
    "1917.1080p.mkv",
    "The.Matrix.1999.1080p.mkv",
    "Spider-Man.No.Way.Home.2021.1080p.mkv",
    "Inception.(2010).[1080p].mkv",
    "Avengers.Endgame.2019.IMAX.2160p.UHD.HDR.mkv",
    "The.Dark.Knight.2008.720p.BrRip.x264.YIFY.mp4",
    "10.Things.I.Hate.About.You.1999.1080p.mkv",
    "300.2006.1080p.mkv",
    "21.Jump.Street.2012.1080p.mkv",
    "8.Mile.2002.1080p.mkv",
    "Catch.Me.If.You.Can.2002.1080p.mkv",
]

for t in tests:
    q, y, r = FilenameAnalyzer.parse(t)
    print(f"{t:48} -> Query: {q!r:30} | Year: {y!r:6} | Res: {r}")
