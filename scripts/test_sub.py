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

def analyze_subtitle(filename):
    stem = Path(filename).stem
    # Handle cases like Inception.2010.1080p.ar or 2_Eng
    # Let's split on dots, underscores, dashes, spaces
    tokens = [t for t in re.split(r'[._\- ]+', stem) if t]
    detected_lang = None
    detected_tags = []
    idx = len(tokens) - 1
    
    while idx >= 0:
        t = tokens[idx].lower()
        # strip leading track number e.g. '2_eng' -> 'eng'
        t_clean = re.sub(r'^\d+', '', t).strip('_')
        if t in SUB_TAGS:
            detected_tags.insert(0, t)
            idx -= 1
        elif t_clean in LANG_MAP:
            detected_lang = LANG_MAP[t_clean]
            idx -= 1
        elif re.match(r'^[a-z]{2}(?:-[a-z]{2,4})?$', t):
            detected_lang = t
            idx -= 1
        else:
            break
            
    suffix_parts = []
    if detected_lang:
        suffix_parts.append(detected_lang)
    suffix_parts.extend(detected_tags)
    
    lang_suffix = ('.' + '.'.join(suffix_parts)) if suffix_parts else ''
    base_stem = '.'.join(tokens[:idx + 1]) if idx >= 0 else ''
    return base_stem, lang_suffix, detected_lang

tests = [
    'Inception.2010.1080p.srt',
    'Inception.2010.1080p.ar.srt',
    'Inception.2010.1080p.AR.srt',
    'Inception.2010.1080p.English.srt',
    'Inception.2010.1080p.Arabic.srt',
    'Inception.2010.1080p.en.forced.srt',
    'Inception.2010.1080p.en-US.srt',
    'Inception.2010.1080p.pt-BR.srt',
    '2_Eng.srt',
    '3_Arabic.srt',
    'English.srt',
    'Arabic.srt',
    'sub.srt',
    'subs.srt',
    'forced.srt',
]

for t in tests:
    b, s, l = analyze_subtitle(t)
    print(f'{t:35} -> base: {b:25} | lang_suffix: {s:15} | lang: {l}')
