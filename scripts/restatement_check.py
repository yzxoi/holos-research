#!/usr/bin/env python3
"""
Restatement Regression Test — Verify theorem statements match between main body and appendix.

After every paper recompile during the audit loop, run this to catch appendix drift:
theorem statements in the main body must match their restatements in the appendix.

Usage:
    python restatement_check.py paper/
    python restatement_check.py paper/ --json
"""

import argparse
import json
import re
import sys
from pathlib import Path


def normalize(s: str) -> str:
    """Normalize a theorem statement for comparison."""
    s = re.sub(r"%.*", "", s)
    s = re.sub(r"\\label\{[^}]*\}", "", s)
    s = re.sub(r"\\(?:ref|eqref|cref|Cref|cite[a-zA-Z]*)\{[^}]*\}", "", s)
    s = re.sub(
        r"\\(?:emph|textbf|textit|mathrm|mathbf|mathsf|mathcal|operatorname)\{([^{}]*)\}",
        r"\1",
        s,
    )
    s = re.sub(r"\\begin\{[^}]+\}|\\end\{[^}]+\}", "", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip().lower()


def extract_label(block: str) -> str | None:
    """Extract \\label{...} from a theorem block."""
    m = re.search(r"\\label\{([^}]+)\}", block)
    return m.group(1) if m else None


def extract_theorems(tex: str) -> list[dict]:
    """Extract all theorem/lemma/proposition/corollary blocks."""
    pattern = re.compile(
        r"(\\begin\{(theorem|lemma|proposition|corollary)\}.*?\\end\{\2\})",
        re.DOTALL,
    )
    results = []
    for m in pattern.finditer(tex):
        block = m.group(1)
        label = extract_label(block)
        kind = m.group(2)
        body_match = re.search(
            rf"\\begin\{{{kind}\}}(?:\[[^\]]*\])?\s*(.*?)\s*\\end\{{{kind}\}}",
            block,
            re.DOTALL,
        )
        body = body_match.group(1) if body_match else ""
        results.append(
            {
                "kind": kind,
                "label": label,
                "raw": block,
                "body": body,
                "normalized": normalize(body),
            }
        )
    return results


def find_appendix_boundary(main_tex: str) -> int | None:
    """Find the line number of \\appendix command."""
    for i, line in enumerate(main_tex.split("\n")):
        if re.match(r"\s*\\appendix\b", line):
            return i
    return None


def classify_files(paper_dir: Path) -> tuple[list[Path], list[Path]]:
    """Classify .tex files into main body and appendix."""
    main_tex = paper_dir / "main.tex"
    if not main_tex.exists():
        return [], []

    content = main_tex.read_text(errors="ignore")
    appendix_line = find_appendix_boundary(content)

    input_pattern = re.compile(r"\\input\{([^}]+)\}")
    inputs = input_pattern.findall(content)

    main_files = []
    appendix_files = []
    in_appendix = False

    for i, line in enumerate(content.split("\n")):
        if appendix_line is not None and i >= appendix_line:
            in_appendix = True
        m = input_pattern.search(line)
        if m:
            path_str = m.group(1)
            if not path_str.endswith(".tex"):
                path_str += ".tex"
            f = paper_dir / path_str
            if f.exists():
                if in_appendix or "appendix" in path_str.lower():
                    appendix_files.append(f)
                else:
                    main_files.append(f)

    return main_files, appendix_files


def main():
    parser = argparse.ArgumentParser(description="Restatement Regression Test")
    parser.add_argument("paper_dir", help="Path to paper/ directory")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    paper_dir = Path(args.paper_dir)
    main_files, appendix_files = classify_files(paper_dir)

    if not main_files and not appendix_files:
        if args.json:
            print(
                json.dumps({"status": "skip", "reason": "No main/appendix files found"})
            )
        else:
            print("⏭️  No main/appendix file classification possible. Skipping.")
        return

    main_text = "\n".join(f.read_text(errors="ignore") for f in main_files)
    appendix_text = "\n".join(f.read_text(errors="ignore") for f in appendix_files)

    main_theorems = extract_theorems(main_text)
    appendix_theorems = extract_theorems(appendix_text)

    if not main_theorems:
        if args.json:
            print(json.dumps({"status": "skip", "reason": "No theorems in main body"}))
        else:
            print("⏭️  No theorems found in main body. Skipping.")
        return

    appendix_by_label = {}
    for t in appendix_theorems:
        if t["label"]:
            appendix_by_label[t["label"]] = t

    results = []
    for mt in main_theorems:
        label = mt["label"]
        if not label:
            results.append(
                {
                    "label": None,
                    "kind": mt["kind"],
                    "status": "NO_LABEL",
                    "detail": "Main body theorem has no label — cannot match to appendix",
                }
            )
            continue

        at = appendix_by_label.get(label)
        if not at:
            results.append(
                {
                    "label": label,
                    "kind": mt["kind"],
                    "status": "NO_RESTATEMENT",
                    "detail": "No matching theorem in appendix",
                }
            )
            continue

        if mt["normalized"] == at["normalized"]:
            results.append(
                {
                    "label": label,
                    "kind": mt["kind"],
                    "status": "MATCH",
                    "detail": "Statements match",
                }
            )
        else:
            results.append(
                {
                    "label": label,
                    "kind": mt["kind"],
                    "status": "DRIFT",
                    "detail": "Statements differ",
                    "main_normalized": mt["normalized"],
                    "appendix_normalized": at["normalized"],
                }
            )

    drift_count = sum(1 for r in results if r["status"] == "DRIFT")
    match_count = sum(1 for r in results if r["status"] == "MATCH")
    no_restate = sum(1 for r in results if r["status"] == "NO_RESTATEMENT")

    if args.json:
        print(
            json.dumps(
                {
                    "status": "fail" if drift_count > 0 else "pass",
                    "total_theorems": len(main_theorems),
                    "matched": match_count,
                    "drifted": drift_count,
                    "no_restatement": no_restate,
                    "results": results,
                },
                indent=2,
            )
        )
    else:
        print(f"=== Restatement Regression Test ===")
        print(f"Main body theorems: {len(main_theorems)}")
        print(f"Appendix theorems: {len(appendix_theorems)}")
        print()

        for r in results:
            icon = {
                "MATCH": "✅",
                "DRIFT": "❌",
                "NO_RESTATEMENT": "⚠️",
                "NO_LABEL": "⚠️",
            }[r["status"]]
            print(
                f"  {icon} [{r['kind']}] {r.get('label', '(no label)')}: {r['status']}"
            )
            if r["status"] == "DRIFT":
                print(f"      Main:     {r['main_normalized'][:100]}...")
                print(f"      Appendix: {r['appendix_normalized'][:100]}...")

        print()
        if drift_count > 0:
            print(
                f"❌ FAIL: {drift_count} theorem(s) drifted between main body and appendix"
            )
            sys.exit(1)
        else:
            print(f"✅ PASS: {match_count} matched, {no_restate} without restatement")


if __name__ == "__main__":
    main()
