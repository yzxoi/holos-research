#!/usr/bin/env python3
"""
Numeric Consistency Check — Heuristic cross-check of paper numbers vs. experiments.

Extracts numbers (floats and percentages) with context from every .tex file
under the paper/ directory and parses metric lines from the experiment
records in experiments/*.yaml using a lightweight parser (no yaml import):

    - `metric: name=12.3`  (flat key-style lines)
    - `name: 12.3`         (mapping lines inside a metrics block)

For every experiment metric value:
  * found exactly in the paper (with float-equivalence, e.g. 0.87 == 0.870) → ok
  * not found at all → warning (missing_metrics: the experiment may not be
    cited, or the number was rewritten)
  * a paper number is close but not equal (relative difference < 2% and
    nonzero) → potential_mismatch candidate for human review

This is advisory: the default status is "pass" unless --strict is given,
which turns potential_mismatch into a failure (exit 1).

Usage:
    python numeric_consistency_check.py paper/
    python numeric_consistency_check.py paper/ --experiments-dir .research/experiments --json
    python numeric_consistency_check.py paper/ --strict
"""

import argparse
import json
import math
import re
import sys
from pathlib import Path

NUMBER_PATTERN = re.compile(r"-?\d+(?:\.\d+)?(?:e[+-]?\d+)?")
PERCENT_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*\\?%")
EXPERIMENT_PATTERN = re.compile(
    r"^\s*(?:-\s*)?(?:\w+\s*:\s*)?(\w+)\s*=\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*$"
)
METRIC_LINE_PATTERN = re.compile(
    r"^\s*(?:-\s+)?(\w+)\s*:\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*$"
)

RELATIVE_THRESHOLD = 0.02
METRIC_KEYS = {
    "metric",
    "metrics",
    "results",
    "eval",
    "evaluation",
    "accuracy",
    "f1",
    "acc",
}


def extract_numbers_from_tex(text: str) -> list[tuple[str, float]]:
    """Return (context snippet, value) for numbers and percentages in tex."""
    clean = re.sub(r"\\%", "\x00", text)
    clean = re.sub(r"%.*", "", clean)
    clean = clean.replace("\x00", "%")
    clean = re.sub(r"\\[a-zA-Z]+\{[^{}]*\}", " ", clean)
    clean = re.sub(r"\\[a-zA-Z]+\b", " ", clean)
    clean = re.sub(r"[{}~$^_&]", " ", clean)

    found: list[tuple[str, float]] = []
    for m in NUMBER_PATTERN.finditer(clean):
        value = float(m.group(0))
        start = max(0, m.start() - 20)
        context = clean[start : m.end() + 30].replace("\n", " ")
        found.append((context, value))
    for m in PERCENT_PATTERN.finditer(clean):
        value = float(m.group(1)) / 100.0
        start = max(0, m.start() - 20)
        context = clean[start : m.end() + 10].replace("\n", " ")
        found.append((context, value))
    return found


def parse_experiment_file(path: Path) -> dict:
    """Parse one experiment yaml file for (metric name, value) pairs."""
    entries: list[dict] = []
    block: str | None = None
    for raw in path.read_text(errors="ignore").split("\n"):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        for key in METRIC_KEYS:
            if line.startswith(key) and ":" in line:
                block = key
                break
        else:
            if ":" not in line and "=" not in line:
                block = None

        m = METRIC_LINE_PATTERN.match(raw)
        if m and block is not None:
            entries.append({"name": m.group(1), "value": float(m.group(2))})
            continue
        m = EXPERIMENT_PATTERN.match(raw)
        if m:
            entries.append({"name": m.group(1), "value": float(m.group(2))})
    return {"file": str(path), "entries": entries}


def close(a: float, b: float) -> bool:
    """True when a and b are close but not equal (relative difference < 2%)."""
    if a == b:
        return False
    if a == 0.0 or b == 0.0:
        return False
    return abs(a - b) / max(abs(a), abs(b)) < RELATIVE_THRESHOLD


def find_mismatches(value: float, numbers: list[tuple[str, float]]) -> list[dict]:
    """Return paper number contexts close to `value` but not equal."""
    matches = []
    for context, num in numbers:
        if close(value, num):
            matches.append({"context": context, "paper_number": num})
    return matches


def main() -> None:
    parser = argparse.ArgumentParser(description="Numeric Consistency Check")
    parser.add_argument("paper_dir", help="Path to paper/ directory")
    parser.add_argument(
        "--experiments-dir",
        default=".research/experiments",
        help="Path to experiment records directory (default: .research/experiments)",
    )
    parser.add_argument("--json", action="store_true", help="Output structured JSON")
    parser.add_argument(
        "--strict", action="store_true", help="Fail on potential mismatches"
    )
    args = parser.parse_args()

    paper_dir = Path(args.paper_dir)
    experiments_dir = Path(args.experiments_dir)

    tex_files = sorted(paper_dir.rglob("*.tex"))
    paper_numbers: list[tuple[str, float]] = []
    checked_files: list[str] = []
    for f in tex_files:
        paper_numbers.extend(extract_numbers_from_tex(f.read_text(errors="ignore")))
        checked_files.append(str(f.relative_to(paper_dir)))

    experiment_files = (
        sorted(experiments_dir.glob("*.yaml")) if experiments_dir.is_dir() else []
    )
    experiments = [parse_experiment_file(f) for f in experiment_files]

    missing_metrics: list[dict] = []
    potential_mismatches: list[dict] = []

    for exp in experiments:
        for entry in exp["entries"]:
            value = entry["value"]
            found = any(abs(value - num) < 1e-9 for _, num in paper_numbers)
            if not found:
                mismatches = find_mismatches(value, paper_numbers)
                if mismatches:
                    for m in mismatches:
                        potential_mismatches.append(
                            {
                                "experiment": Path(exp["file"]).stem,
                                "metric": entry["name"],
                                "experiment_value": value,
                                "paper_number": m["paper_number"],
                                "context": m["context"],
                            }
                        )
                else:
                    missing_metrics.append(
                        {
                            "experiment": Path(exp["file"]).stem,
                            "metric": entry["name"],
                            "value": value,
                        }
                    )

    strict_failed = args.strict and bool(potential_mismatches)
    result = {
        "status": "fail" if strict_failed else "pass",
        "checked_files": checked_files,
        "missing_metrics": missing_metrics,
        "potential_mismatches": potential_mismatches,
        "checked_numbers": [num for _, num in paper_numbers],
    }

    if args.json:
        print(json.dumps(result, indent=2))
        if strict_failed:
            sys.exit(1)
        return

    print("=== Numeric Consistency Check ===")
    print(f"Checked files: {', '.join(checked_files) or '(none)'}")
    print(
        f"Experiment files: {', '.join(Path(e['file']).name for e in experiments) or '(none)'}"
    )
    print(f"Numbers extracted from paper: {len(paper_numbers)}")
    for m in missing_metrics:
        print(
            f"⚠️  [missing] {m['experiment']} metric '{m['metric']}' = {m['value']} "
            "not found in paper"
        )
    for m in potential_mismatches:
        print(
            f"⚠️  [mismatch] {m['experiment']} '{m['metric']}' = {m['experiment_value']} "
            f"vs paper {m['paper_number']}  ({m['context'][:60]})"
        )
    print()
    if strict_failed:
        print(f"❌ FAIL (--strict): {len(potential_mismatches)} potential mismatch(es)")
        sys.exit(1)
    print(
        f"✅ PASS: advisory check ({len(missing_metrics)} missing, "
        f"{len(potential_mismatches)} potential mismatch(es))"
    )


if __name__ == "__main__":
    main()
