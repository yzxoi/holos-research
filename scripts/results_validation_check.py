#!/usr/bin/env python3
"""
Results Validation Matrix Gate — Check the seven-column results matrix.

The file must contain a header row with all seven required columns (in any
order) followed by at least one data row. Empty or placeholder-filled
"Contribution Claim Tested" / "Result/Evidence" cells are hard failures;
empty "Allowed Interpretation" / "Interpretation NOT Allowed" cells and
placeholders in other columns are warnings.

Markdown tables are parsed by splitting on "|"; separator rows such as
|---|---|---| are skipped.

Usage:
    python results_validation_check.py results_validation.md
    python results_validation_check.py .research/compose --json
"""

import argparse
import json
import re
import sys
from pathlib import Path

REQUIRED_COLUMNS = [
    "Results Unit",
    "Contribution Claim Tested",
    "Result/Evidence",
    "Figure/Table",
    "Confirmatory Condition",
    "Allowed Interpretation",
    "Interpretation NOT Allowed",
]

HARD_COLUMNS = {"Contribution Claim Tested", "Result/Evidence"}
WARN_EMPTY_COLUMNS = {"Allowed Interpretation", "Interpretation NOT Allowed"}
PLACEHOLDER = re.compile(r"todo|tbd|\.\.\.", re.IGNORECASE)
SEPARATOR_CELL = re.compile(r"^:?-{3,}:?$")


def split_row(line: str) -> list[str]:
    """Split a markdown table row into trimmed cells."""
    return [c.strip() for c in line.strip().strip("|").split("|")]


def is_separator_row(line: str) -> bool:
    """True for markdown table separator rows like |---|---|."""
    if not line.strip():
        return False
    return all(SEPARATOR_CELL.match(c) for c in split_row(line))


def find_header(lines: list[str]) -> tuple[int | None, dict[str, int]]:
    """Return (header line index, column-name -> cell-index map), or (None, {})."""
    for idx, line in enumerate(lines):
        if not line.strip() or is_separator_row(line) or "|" not in line:
            continue
        cells = split_row(line)
        column_map: dict[str, int] = {}
        for col in REQUIRED_COLUMNS:
            for i, cell in enumerate(cells):
                if cell.lower() == col.lower():
                    column_map[col] = i
                    break
        if len(column_map) == len(REQUIRED_COLUMNS):
            return idx, column_map
        return None, {}
    return None, {}


def collect_data_rows(lines: list[str], header_idx: int) -> list[tuple[int, list[str]]]:
    """Return (1-based line number, cells) for each data row after the header."""
    rows: list[tuple[int, list[str]]] = []
    for lineno in range(header_idx + 1, len(lines)):
        line = lines[lineno]
        if not line.strip():
            break
        if is_separator_row(line):
            continue
        if "|" not in line:
            continue
        rows.append((lineno + 1, split_row(line)))
    return rows


def cell_at(row: list[str], column_map: dict[str, int], column: str) -> str:
    """Read one column's cell from a row, empty string when absent."""
    idx = column_map.get(column)
    if idx is None or idx >= len(row):
        return ""
    return row[idx]


def main() -> None:
    parser = argparse.ArgumentParser(description="Results Validation Matrix Gate")
    parser.add_argument(
        "path",
        help="Path to results_validation.md or its directory",
    )
    parser.add_argument("--json", action="store_true", help="Output structured JSON")
    args = parser.parse_args()

    target = Path(args.path)
    if target.is_dir():
        target = target / "results_validation.md"

    if not target.is_file():
        result = {
            "status": "fail",
            "reason": f"File not found: {target}",
            "header_ok": False,
            "row_count": 0,
            "hard_failures": [],
            "warnings": [],
        }
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print("=== Results Validation Matrix Gate ===")
            print(f"❌ FAIL: {target} not found")
        sys.exit(1)

    lines = target.read_text(errors="ignore").split("\n")
    header_idx, column_map = find_header(lines)
    header_ok = header_idx is not None

    hard_failures: list[dict] = []
    warnings: list[dict] = []
    row_count = 0

    if header_ok:
        for lineno, cells in collect_data_rows(lines, header_idx):
            row_count += 1
            for col in HARD_COLUMNS:
                value = cell_at(cells, column_map, col)
                if not value:
                    hard_failures.append(
                        {"line": lineno, "column": col, "reason": "empty"}
                    )
                elif PLACEHOLDER.search(value):
                    hard_failures.append(
                        {
                            "line": lineno,
                            "column": col,
                            "reason": f"placeholder: {value[:40]}",
                        }
                    )
            for col in WARN_EMPTY_COLUMNS:
                value = cell_at(cells, column_map, col)
                if not value:
                    warnings.append({"line": lineno, "column": col, "reason": "empty"})
                elif PLACEHOLDER.search(value):
                    warnings.append(
                        {
                            "line": lineno,
                            "column": col,
                            "reason": f"placeholder: {value[:40]}",
                        }
                    )
            for col in REQUIRED_COLUMNS:
                if col in HARD_COLUMNS or col in WARN_EMPTY_COLUMNS:
                    continue
                value = cell_at(cells, column_map, col)
                if value and PLACEHOLDER.search(value):
                    warnings.append(
                        {
                            "line": lineno,
                            "column": col,
                            "reason": f"placeholder: {value[:40]}",
                        }
                    )

    no_rows = header_ok and row_count == 0
    failed = (not header_ok) or no_rows or bool(hard_failures)
    result = {
        "status": "fail" if failed else "pass",
        "header_ok": header_ok,
        "row_count": row_count,
        "hard_failures": hard_failures,
        "warnings": warnings,
    }

    if args.json:
        print(json.dumps(result, indent=2))
        if failed:
            sys.exit(1)
        return

    print("=== Results Validation Matrix Gate ===")
    if header_ok:
        print(f"✅ Header: all {len(REQUIRED_COLUMNS)} required columns present")
        print(f"Data rows: {row_count}")
    else:
        print("❌ Header: missing or incomplete required columns")
    for f in hard_failures:
        print(f"❌ [line {f['line']}] {f['column']}: {f['reason']}")
    for w in warnings:
        print(f"⚠️  [line {w['line']}] {w['column']}: {w['reason']}")
    print()
    if failed:
        reasons = []
        if not header_ok:
            reasons.append("header missing/incomplete")
        if no_rows:
            reasons.append("no data rows")
        if hard_failures:
            reasons.append(f"{len(hard_failures)} hard failure(s)")
        print(f"❌ FAIL: {', '.join(reasons)}")
        sys.exit(1)
    print(f"✅ PASS: matrix gate passed ({len(warnings)} warning(s))")


if __name__ == "__main__":
    main()
