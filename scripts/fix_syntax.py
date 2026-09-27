import py_compile
from pathlib import Path

target_file = Path(r"C:\Users\Ahmed\Downloads\Renamers\movie_renamer.py")

# Read lines and fix any regex syntax errors
lines = target_file.read_text(encoding="utf-8").splitlines()
new_lines = []
for line in lines:
    if "TMDbClient._normalize" in line or 't = re.sub(r"[\:' in line or 't = re.sub(r"[:\-' in line:
        new_lines.append('        t = re.sub(r"[^\\w\\s]", " ", t)')
    elif "ALREADY_CORRECT_RE  = re.compile" in line:
        new_lines.append('    ALREADY_CORRECT_RE  = re.compile(r"^\\(\\d{4}\\) - .+")')
    elif "WINDOWS_ILLEGAL_RE  = re.compile" in line:
        new_lines.append('    WINDOWS_ILLEGAL_RE  = re.compile(r\'[\\\\/*?:"<>|]\')')
    else:
        new_lines.append(line)

target_file.write_text("\n".join(new_lines), encoding="utf-8")

try:
    py_compile.compile(str(target_file), doraise=True)
    print("Syntax validation: PASS")
except py_compile.PyCompileError as e:
    print(f"Syntax validation: FAIL -> {e}")
