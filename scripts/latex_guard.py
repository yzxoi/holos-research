#!/usr/bin/env python3
r"""
LaTeX Citation Guard — Check .tex files under the paper/ directory.

Checks (any failure → exit 1):
  * Literal bracket citations — hand-typed `[1]`, `[3,12]`, `[1-5]` with no
    `\cite{...}` on the same line → FAIL (comment lines and `%`-trailing
    content are skipped, `\begin{...}` args are not citation contexts).
  * Missing `\title` / `\maketitle` in the main tex (the file containing
    `\documentclass`).
  * Undefined `\cite` keys — keys from `\cite{...}` / `\citep{...}` /
    `\citet{...}` are checked against `\bibitem{key}` entries and the
    `.bib` file referenced by `\bibliography{...}`.
  * `([15])` style citations (`(` immediately followed by `\cite`) → warning.

Usage:
    python latex_guard.py paper/
    python latex_guard.py paper/ --json
"""

import argparse
import json
import re
import sys
from pathlib import Path

CITE_PATTERN = re.compile(r"\\cite[a-zA-Z]*\{([^}]*)\}")
LITERAL_CITE_PATTERN = re.compile(r"\[[\d\s,\-]+\]")
BIBLIOGRAPHY_PATTERN = re.compile(r"\\bibliography\{([^}]*)\}")
BIBITEM_PATTERN = re.compile(r"\\bibitem(?:\s*\[[^\]]*\])?\{([^}]+)\}")
TITLE_PATTERN = re.compile(r"\\title\s*\{")
MAKETITLE_PATTERN = re.compile(r"\\maketitle\b")
PAREN_CITE_PATTERN = re.compile(r"\(\s*\\cite")


def strip_comments(tex: str) -> str:
    """Remove `%` comments while preserving newlines for line numbers. Escaped `\\%` is kept."""
    return re.sub(r"(?<!\\)%.*", "", tex)


def iter_lines_with_numbers(tex: str) -> list[tuple[int, str]]:
    """Return (1-based line number, comment-stripped line) pairs."""
    return [(i + 1, line) for i, line in enumerate(strip_comments(tex).split("\n"))]


def strip_braced_args(line: str) -> str:
    """Remove {...} arguments to drop non-citation contexts like \\begin{...}."""
    prev = None
    while prev != line:
        prev = line
        line = re.sub(r"\{[^{}]*\}", "", line)
    return line


def collect_bibitem_keys(tex: str) -> set[str]:
    """Collect all `\\bibitem{key}` keys from a tex source."""
    return set(BIBITEM_PATTERN.findall(tex))


def collect_bib_keys(bib: str) -> set[str]:
    """Collect `@entry{key,` keys from a .bib source."""
    return set(re.findall(r"@\w+\s*\{\s*([^,\s]+)\s*,", bib))


def find_main_tex(tex_files: list[Path]) -> Path | None:
    """Return the .tex file containing \\documentclass, if any."""
    for f in tex_files:
        if re.search(r"\\documentclass\b", f.read_text(errors="ignore")):
            return f
    return None


def collect_defined_keys(tex_files: list[Path], main_tex: Path | None) -> set[str]:
    """All citation keys defined via \\bibitem or referenced .bib files."""
    defined: set[str] = set()
    for f in tex_files:
        defined |= collect_bibitem_keys(f.read_text(errors="ignore"))

    if main_tex is None:
        return defined

    main_content = main_tex.read_text(errors="ignore")
    for bib_name in BIBLIOGRAPHY_PATTERN.findall(main_content):
        for suffix in (".bib", ""):
            candidate = main_tex.parent / f"{bib_name}{suffix}"
            if candidate.is_file():
                defined |= collect_bib_keys(candidate.read_text(errors="ignore"))
                break
    return defined


def main() -> None:
    parser = argparse.ArgumentParser(description="LaTeX Citation Guard")
    parser.add_argument("paper_dir", help="Path to paper/ directory")
    parser.add_argument("--json", action="store_true", help="Output structured JSON")
    args = parser.parse_args()

    paper_dir = Path(args.paper_dir)
    if not paper_dir.is_dir():
        result = {
            "status": "fail",
            "reason": f"Paper directory not found: {paper_dir}",
            "checked_files": [],
            "literal_citations": [],
            "missing_title": False,
            "undefined_cites": [],
            "warnings": [],
        }
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print("=== LaTeX Citation Guard ===")
            print(f"❌ FAIL: {paper_dir} not found")
        sys.exit(1)

    tex_files = sorted(paper_dir.rglob("*.tex"))
    if not tex_files:
        result = {
            "status": "fail",
            "reason": "No .tex files found",
            "checked_files": [],
            "literal_citations": [],
            "missing_title": False,
            "undefined_cites": [],
            "warnings": [],
        }
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print("=== LaTeX Citation Guard ===")
            print("❌ FAIL: no .tex files found")
        sys.exit(1)

    main_tex = find_main_tex(tex_files)
    contents = {f: f.read_text(errors="ignore") for f in tex_files}

    literal_citations: list[dict] = []
    undefined_cites: list[str] = []
    warnings: list[dict] = []
    missing_title = False

    for f in tex_files:
        for lineno, line in iter_lines_with_numbers(contents[f]):
            if not line.strip():
                continue
            if re.match(r"\\(?:begin|end)\{", line.strip()):
                continue
            if CITE_PATTERN.search(line):
                continue
            for match in LITERAL_CITE_PATTERN.findall(strip_braced_args(line)):
                literal_citations.append(
                    {
                        "file": str(f.relative_to(paper_dir)),
                        "line": lineno,
                        "text": line.strip()[:100],
                        "match": match,
                    }
                )
            if PAREN_CITE_PATTERN.search(line):
                warnings.append(
                    {
                        "file": str(f.relative_to(paper_dir)),
                        "line": lineno,
                        "type": "paren_cite",
                        "text": line.strip()[:100],
                    }
                )

    if main_tex is not None:
        main_content = contents[main_tex]
        missing_title = not (
            TITLE_PATTERN.search(main_content)
            and MAKETITLE_PATTERN.search(main_content)
        )

        defined = collect_defined_keys(tex_files, main_tex)
        for f in tex_files:
            for key_group in CITE_PATTERN.findall(strip_comments(contents[f])):
                for key in re.split(r"\s*,\s*", key_group.strip()):
                    if key and key not in defined:
                        undefined_cites.append(f"{f.relative_to(paper_dir)}: {key}")
        undefined_cites = sorted(set(undefined_cites))

    failed = bool(literal_citations) or missing_title or bool(undefined_cites)
    result = {
        "status": "fail" if failed else "pass",
        "checked_files": [str(f.relative_to(paper_dir)) for f in tex_files],
        "literal_citations": literal_citations,
        "missing_title": missing_title,
        "undefined_cites": undefined_cites,
        "warnings": warnings,
    }

    if args.json:
        print(json.dumps(result, indent=2))
        if failed:
            sys.exit(1)
        return

    print("=== LaTeX Citation Guard ===")
    print(f"Checked files: {', '.join(result['checked_files'])}")
    if literal_citations:
        for c in literal_citations:
            print(f"❌ [literal cite] {c['file']}:{c['line']}  {c['text']}")
    if missing_title:
        print("❌ main tex missing \\title{...} or \\maketitle")
    if undefined_cites:
        for c in undefined_cites:
            print(f"❌ [undefined cite] {c}")
    for w in warnings:
        print(f"⚠️  [paren cite] {w['file']}:{w['line']}  {w['text']}")
    print()
    if failed:
        print("❌ FAIL: citation guard violations found")
        sys.exit(1)
    print(f"✅ PASS: citation guard passed ({len(warnings)} warning(s))")


if __name__ == "__main__":
    main()
