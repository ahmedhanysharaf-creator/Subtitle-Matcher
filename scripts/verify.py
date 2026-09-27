from pathlib import Path

target_file = Path(r"C:\Users\Ahmed\Downloads\Renamers\Marvel Films renamer.py")
content = target_file.read_text(encoding="utf-8")
lines = content.splitlines()

for i, l in enumerate(lines):
    if l.startswith("def main():"):
        for j in range(i, min(i+15, len(lines))):
            safe_line = lines[j].encode('ascii', errors='replace').decode('ascii')
            print(f"{j+1}: {safe_line}")
        break
