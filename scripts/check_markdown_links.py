from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
LINK_PATTERN = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")
SKIPPED_PREFIXES = ("http://", "https://", "mailto:", "#", "sandbox:")


def main() -> int:
    broken: list[str] = []
    for markdown_file in sorted(ROOT.rglob("*.md")):
        if any(part in {"node_modules", ".venv"} for part in markdown_file.parts):
            continue
        content = markdown_file.read_text(encoding="utf-8")
        for raw_target in LINK_PATTERN.findall(content):
            target = raw_target.strip().strip("<>")
            if not target or target.startswith(SKIPPED_PREFIXES):
                continue
            path_text = unquote(target.split("#", 1)[0])
            if not path_text:
                continue
            destination = (markdown_file.parent / path_text).resolve()
            if not destination.exists():
                relative_file = markdown_file.relative_to(ROOT)
                broken.append(f"{relative_file}: {target}")

    if broken:
        print("Broken relative Markdown links:")
        for item in broken:
            print(f"- {item}")
        return 1

    print("All relative Markdown links resolve.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
