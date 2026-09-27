import os
import sys
import tempfile
import shutil
from pathlib import Path

# Add target script directory to sys.path
sys.path.insert(0, r"C:\Users\Ahmed\Downloads\Renamers")
import movie_renamer

print("Imported movie_renamer version:", movie_renamer.Config.VERSION)

# Test 1: Filename Analyzer
test_cases = [
    ("Blade.Runner.2049.2017.1080p.BluRay.x264.mkv", "Blade Runner 2049", "2017", "1080p"),
    ("1917.2019.1080p.mkv", "1917", "2019", "1080p"),
    ("2001.A.Space.Odyssey.1968.1080p.mkv", "2001 A Space Odyssey", "1968", "1080p"),
    ("2012.2009.1080p.mkv", "2012", "2009", "1080p"),
    ("1917.1080p.mkv", "1917", None, "1080p"),
    ("The.Matrix.1999.1080p.mkv", "The Matrix", "1999", "1080p"),
    ("300.2006.1080p.mkv", "300", "2006", "1080p"),
    ("21.Jump.Street.2012.1080p.mkv", "21 Jump Street", "2012", "1080p"),
    ("8.Mile.2002.1080p.mkv", "8 Mile", "2002", "1080p"),
    ("Inception.(2010).[1080p].mkv", "Inception", "2010", "1080p"),
]

for filename, exp_q, exp_y, exp_r in test_cases:
    q, y, r = movie_renamer.FilenameAnalyzer.parse(filename)
    assert q == exp_q, f"Query mismatch for {filename}: got {q!r}, expected {exp_q!r}"
    assert y == exp_y, f"Year mismatch for {filename}: got {y!r}, expected {exp_y!r}"
    assert r == exp_r, f"Res mismatch for {filename}: got {r!r}, expected {exp_r!r}"

print("Test 1 (FilenameAnalyzer): ALL 10 CASES PASSED!")

# Test 2: Subtitle File Language Detection
sub_tests = [
    ("Movie.2010.1080p.srt", "", None),
    ("Movie.2010.1080p.ar.srt", ".ar", "ar"),
    ("Movie.2010.1080p.AR.srt", ".ar", "ar"),
    ("Movie.2010.1080p.English.srt", ".en", "en"),
    ("Movie.2010.1080p.Arabic.srt", ".ar", "ar"),
    ("Movie.2010.1080p.en.forced.srt", ".en.forced", "en"),
    ("Movie.2010.1080p.en-US.srt", ".en", "en"),
    ("2_Eng.srt", ".en", "en"),
    ("3_Arabic.srt", ".ar", "ar"),
    ("forced.srt", ".forced", None),
]

for sub_name, exp_suffix, exp_lang in sub_tests:
    sf = movie_renamer.SubtitleFile(Path(sub_name))
    assert sf.lang_suffix == exp_suffix, f"Lang suffix mismatch for {sub_name}: got {sf.lang_suffix!r}, expected {exp_suffix!r}"
    assert sf.lang == exp_lang, f"Lang mismatch for {sub_name}: got {sf.lang!r}, expected {exp_lang!r}"

print("Test 2 (SubtitleFile Detection): ALL 10 CASES PASSED!")

# Test 3: Subtitle Planning & Collision Disambiguation
subs = [
    movie_renamer.SubtitleFile(Path("English.srt")),
    movie_renamer.SubtitleFile(Path("2_English.srt")),
    movie_renamer.SubtitleFile(Path("Arabic.srt")),
]
planned = movie_renamer.FilenameBuilder.plan_subtitles("(2010) - Inception - 1080p", subs)
assert planned[0][1] == "(2010) - Inception - 1080p.en.srt"
assert planned[1][1] == "(2010) - Inception - 1080p.en.2.srt"
assert planned[2][1] == "(2010) - Inception - 1080p.ar.srt"

print("Test 3 (Subtitle Collision Disambiguation): PASSED!")

# Test 4: End-to-end Scan, Rename and Undo
tmp_dir = Path(tempfile.mkdtemp(prefix="test_live_renamer_"))
try:
    m_dir = tmp_dir / "Movie (2020)"
    m_subs = m_dir / "Subs"
    m_subs.mkdir(parents=True)
    
    vid = m_dir / "Movie.2020.1080p.BluRay.x264.mkv"
    s1 = m_subs / "English.srt"
    s2 = m_subs / "Arabic.srt"
    
    vid.write_text("v")
    s1.write_text("s1")
    s2.write_text("s2")
    
    entries = movie_renamer.FileScanner.scan(tmp_dir)
    assert len(entries) == 1
    assert len(entries[0].subtitles) == 2
    
    entry = entries[0]
    entry.new_stem = "(2020) - The Movie - 1080p"
    entry.status = "queued"
    
    engine = movie_renamer.RenameEngine()
    engine.rename_entry(entry)
    
    assert (m_dir / "(2020) - The Movie - 1080p.mkv").exists()
    assert (m_subs / "(2020) - The Movie - 1080p.en.srt").exists()
    assert (m_subs / "(2020) - The Movie - 1080p.ar.srt").exists()
    
    # Test Undo Writer
    undo_writer = movie_renamer.UndoWriter(tmp_dir)
    undo_writer.write(engine.undo_pairs)
    
    # Run Undo Script directly
    undo_script = undo_writer.script_path
    import subprocess
    res = subprocess.run([sys.executable, str(undo_script)], capture_output=True, text=True)
    assert res.returncode == 0
    assert vid.exists()
    assert s1.exists()
    assert s2.exists()
    
    print("Test 4 (End-to-End Scan, Rename & Undo): PASSED!")
finally:
    shutil.rmtree(tmp_dir, ignore_errors=True)

print("\nALL VERIFICATION TESTS COMPLETED WITH 100% SUCCESS!")
