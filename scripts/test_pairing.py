import re
from pathlib import Path

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
SUBS_DIR_NAMES = {'subs', 'subtitles', 'sub', 'feature.subs', 'sub_titles'}
GENERIC_SUB_STEMS = {'sub', 'subs', 'subtitle', 'subtitles', 'english', 'arabic', 'und', 'audio'}

class SubtitleFile:
    def __init__(self, path):
        self.path = path
        self.ext = path.suffix.lower()
        self.bare_stem, self.lang_suffix, self.lang = self._analyze(path.stem)
        
    @classmethod
    def _analyze(cls, stem):
        # normalize separators
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
        
        # Remaining base stem
        remaining = tokens[:idx + 1]
        bare = '.'.join(remaining) if remaining else ''
        return bare, lang_suffix, detected_lang

def normalize_stem_for_matching(s):
    if not s:
        return ''
    return re.sub(r'[^a-z0-9]+', '', s.lower())

def pair_videos_and_subs(video_paths, sub_paths):
    # Group videos by directory
    dir_to_videos = {}
    for vp in sorted(video_paths):
        dir_to_videos.setdefault(vp.parent, []).append(vp)
        
    # Prepare subtitle objects
    subs = [SubtitleFile(sp) for sp in sorted(sub_paths)]
    
    # Mapping from video path to matched subtitles
    video_subs = {vp: [] for vp in video_paths}
    unmatched_subs = []
    
    # 1. Exact or normalized base stem match in same directory
    for s in subs:
        p_dir = s.path.parent
        # If subtitle is in a Subs/ subfolder, effective dir is parent of Subs/
        effective_dir = p_dir.parent if p_dir.name.lower() in SUBS_DIR_NAMES else p_dir
        
        candidates = dir_to_videos.get(p_dir, []) or dir_to_videos.get(effective_dir, [])
        
        matched_video = None
        s_norm = normalize_stem_for_matching(s.bare_stem)
        
        if s_norm:
            # Check exact match
            for vp in candidates:
                v_norm = normalize_stem_for_matching(vp.stem)
                if s_norm == v_norm:
                    matched_video = vp
                    break
            # Check prefix match (e.g. Inception.srt for Inception.2010.1080p.mkv)
            if not matched_video:
                for vp in candidates:
                    v_norm = normalize_stem_for_matching(vp.stem)
                    if v_norm.startswith(s_norm) and len(s_norm) >= 4:
                        matched_video = vp
                        break
        
        if matched_video:
            video_subs[matched_video].append(s)
        else:
            unmatched_subs.append((s, effective_dir))
            
    # 2. Single-movie folder fallback: if a directory has exactly 1 video, pair remaining subs in that folder or its Subs/ folder
    for s, eff_dir in unmatched_subs:
        vids = dir_to_videos.get(eff_dir, [])
        if len(vids) == 1:
            video_subs[vids[0]].append(s)
            
    return video_subs

# Test scenario
test_files = [
    # Case 1: Subs subfolder in Movie folder
    ('D:/Films/Inception (2010)/Inception.2010.1080p.mkv', 'video'),
    ('D:/Films/Inception (2010)/Subs/English.srt', 'sub'),
    ('D:/Films/Inception (2010)/Subs/Arabic.srt', 'sub'),
    ('D:/Films/Inception (2010)/Subs/2_Eng.srt', 'sub'),
    
    # Case 2: Generic names in single-movie folder
    ('D:/Films/Avatar (2009)/Avatar.2009.2160p.mkv', 'video'),
    ('D:/Films/Avatar (2009)/sub.srt', 'sub'),
    ('D:/Films/Avatar (2009)/forced.srt', 'sub'),
    
    # Case 3: Flat directory with multiple movies
    ('D:/Films/Flat/Gladiator.2000.1080p.mkv', 'video'),
    ('D:/Films/Flat/Gladiator.2000.1080p.en.srt', 'sub'),
    ('D:/Films/Flat/Gladiator.2000.1080p.ar.srt', 'sub'),
    ('D:/Films/Flat/Titanic.1997.1080p.mkv', 'video'),
    ('D:/Films/Flat/Titanic.1997.1080p.ar.srt', 'sub'),
]

vids = [Path(f) for f, t in test_files if t == 'video']
subs = [Path(f) for f, t in test_files if t == 'sub']

pairs = pair_videos_and_subs(vids, subs)
for v, s_list in pairs.items():
    print(f'\nVideo: {v}')
    for s in s_list:
        print(f'  -> Sub: {s.path.name} (lang_suffix={s.lang_suffix!r}, path={s.path})')
