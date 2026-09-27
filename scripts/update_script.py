import re
from pathlib import Path

target_file = Path(r"C:\Users\Ahmed\Downloads\Renamers\Marvel Films renamer.py")
content = target_file.read_text(encoding="utf-8")

# Replace while True loop that asks for full path
old_block_pattern = re.compile(
    r"[ \t]*while True:\s*\n[ \t]*raw\s*=\s*input\([\"']Enter the full path to your Marvel movies folder:[\s\S]*?Please try again\.\\n[\"']\)\s*\n",
    re.MULTILINE
)

replacement = "    folder = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent\n"

if old_block_pattern.search(content):
    new_content = old_block_pattern.sub(replacement, content)
    target_file.write_text(new_content, encoding="utf-8")
    print("SUCCESS")
else:
    # Try simpler substring replacement
    lines = content.splitlines(keepends=True)
    out = []
    skip = False
    replaced = False
    for line in lines:
        if "Enter the full path to your Marvel movies folder" in line:
            # rewind while True
            if out and "while True:" in out[-1]:
                out.pop()
            out.append(replacement)
            skip = True
            replaced = True
            continue
        if skip:
            if "Please try again" in line or "break" in line or "_r('Not a valid folder.')" in line:
                continue
            else:
                skip = False
        out.append(line)
    
    if replaced:
        target_file.write_text("".join(out), encoding="utf-8")
        print("SUCCESS_FALLBACK")
    else:
        print("FAILED_TO_LOCATE")
